package com.watchparty.auth;

import com.watchparty.common.ApiException;
import com.watchparty.config.AppProperties;
import com.watchparty.user.AppUser;
import com.watchparty.user.AppUserRepository;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Proving an email address belongs to the person who signed up.
 *
 * <p>The link is a 256-bit random value, stored only as a SHA-256 hash and
 * spendable once, the same shape as a refresh token. Issuing a new link
 * retires the previous ones, so a forwarded old email stops working.
 *
 * <p>Where verification is enforced, a new local sign-up never becomes an
 * account until it is confirmed: it waits in {@link PendingRegistration} and
 * the account is created from {@link #redeemRegistrationCode} or
 * {@link #redeemRegistrationLink}. Accounts created before that (or on a
 * stack that does not enforce it) can still be confirmed afterwards.
 *
 * <p>What being unverified costs: hosting a room. Joining one as a guest never
 * needs an account at all, so an unverified account can still watch, chat and
 * react — only creating a room is refused. Google accounts arrive verified.
 */
@Service
public class EmailVerificationService {

    private static final Logger log = LoggerFactory.getLogger(EmailVerificationService.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    /**
     * Wrong codes one issued email survives. Six digits is a small space, so
     * this, rather than the hash, is what makes guessing pointless: the row
     * dies and a fresh code has to be asked for.
     */
    static final int MAX_CODE_ATTEMPTS = 6;

    private final EmailVerificationRepository links;
    private final PendingRegistrationRepository pending;
    private final AppUserRepository users;
    private final Mailer mailer;
    private final AppProperties props;

    public EmailVerificationService(
            EmailVerificationRepository links,
            PendingRegistrationRepository pending,
            AppUserRepository users,
            Mailer mailer,
            AppProperties props) {
        this.links = links;
        this.pending = pending;
        this.users = users;
        this.mailer = mailer;
        this.props = props;
    }

    /**
     * Whether an unverified account is actually held back.
     *
     * <p>Unset follows the mail setup: enforced wherever mail can be sent, and
     * not on a development machine with no SMTP host, where nobody could
     * receive the link. {@code app.verification.required} overrides either way.
     */
    public static boolean required(Boolean configuredOverride, boolean mailConfigured) {
        return configuredOverride == null ? mailConfigured : configuredOverride;
    }

    public boolean required() {
        return required(props.verification().required(), mailer.configured());
    }

    /** Sends a fresh link, retiring any earlier one. Quietly does nothing for a verified account. */
    public void issue(AppUser user) {
        if (user.isEmailVerified() || user.getEmail() == null) {
            return;
        }
        links.deleteUnusedFor(user.getId());
        String raw = randomValue();
        String code = randomCode();
        links.save(new EmailVerification(
                user.getId(), hash(raw), hash(code), user.getEmail(), Instant.now().plus(props.verification().ttl())));

        sendCode(user.getEmail(), user.getDisplayName(), code, "/verify?token=" + urlEncode(raw));
        log.info("Issued an email verification code and link for user {}", user.getId());
    }

    /**
     * Redeems a link.
     *
     * @return the now-verified account
     * @throws ApiException if the link is unknown, expired or already spent
     */
    public AppUser verify(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            throw ApiException.badRequest("verification_missing", "That link is missing its token.");
        }
        String tokenHash = hash(rawToken);
        if (links.spend(tokenHash, Instant.now()) != 1) {
            throw ApiException.badRequest(
                    "verification_invalid", "That link has expired or was already used. Ask for a new one.");
        }
        EmailVerification link = links.findByTokenHash(tokenHash)
                .orElseThrow(() -> ApiException.badRequest("verification_invalid", "That link is not valid."));
        AppUser user = users.findById(link.getUserId())
                .orElseThrow(() -> ApiException.unauthorized("unknown_user", "Account not found."));

        // The address may have changed since the link was sent.
        if (user.getEmail() == null || !user.getEmail().equalsIgnoreCase(link.getEmail())) {
            throw ApiException.badRequest(
                    "verification_stale", "That link was sent to a different address. Ask for a new one.");
        }
        if (!user.isEmailVerified()) {
            user.markEmailVerified();
            users.save(user);
            log.info("Verified the email address of user {}", user.getId());
        }
        return user;
    }

    /**
     * Redeems the six-digit code for the account that asked for it.
     *
     * <p>Signed in, unlike the link: the code is short enough that it must be
     * tied to one account, and whoever types it just registered on this device.
     *
     * @return the now-verified account
     */
    public AppUser verifyCode(AppUser user, String rawCode) {
        if (user.isEmailVerified()) {
            return user;
        }
        String digits = rawCode == null ? "" : rawCode.replaceAll("\\s+", "");
        if (!digits.matches("\\d{6}")) {
            throw ApiException.badRequest("code_invalid", "That code should be six digits.");
        }
        if (links.spendByCode(user.getId(), hash(digits), Instant.now(), MAX_CODE_ATTEMPTS) != 1) {
            links.countFailedAttempt(user.getId());
            int left = links.findFirstByUserIdAndUsedAtIsNullOrderByCreatedAtDesc(user.getId())
                    .map(link -> MAX_CODE_ATTEMPTS - link.getAttempts())
                    .orElse(0);
            throw ApiException.badRequest(
                    "code_invalid",
                    left > 0
                            ? "That code is not right. " + left + (left == 1 ? " try left." : " tries left.")
                            : "Too many tries. Ask for a new code.");
        }
        user.markEmailVerified();
        users.save(user);
        log.info("Verified the email address of user {} by code", user.getId());
        return user;
    }

    // ---- Sign-ups waiting on their code ------------------------------------

    /**
     * Holds a sign-up until its address is confirmed, and emails the code and
     * link for it. Registering the same address again replaces the earlier
     * sign-up, so only the newest email works.
     *
     * @param guestId the guest pass the registrant held, if any, so they keep
     *     their seat once the account exists
     */
    public void startRegistration(
            String email, String passwordHash, String displayName, UUID guestId, UUID guestRoomId) {
        pending.deleteByEmail(email);
        String raw = randomValue();
        String code = randomCode();
        try {
            pending.save(new PendingRegistration(
                    email,
                    passwordHash,
                    displayName,
                    hash(raw),
                    hash(code),
                    guestId,
                    guestRoomId,
                    Instant.now().plus(props.verification().ttl())));
        } catch (DataIntegrityViolationException race) {
            // Two registrations for one address at the same moment.
            throw ApiException.conflict("registration_busy", "That address is being registered. Try again.");
        }
        try {
            sendCode(email, displayName, code, "/verify?signup=" + urlEncode(raw));
        } catch (RuntimeException ex) {
            // Without the email there is no way to finish, so say so now.
            log.warn("Could not send the sign-up confirmation email", ex);
            pending.deleteByEmail(email);
            throw new ApiException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "mail_unavailable",
                    "We could not send the confirmation email. Try again in a minute.");
        }
        log.info("Holding a sign-up until its email address is confirmed");
    }

    /**
     * Sends a fresh code and link for a sign-up that is still waiting, which
     * retires the earlier ones. Quietly does nothing if there is none.
     */
    public void resendRegistration(String email) {
        pending.findByEmailIgnoreCase(email)
                .filter(row -> row.getUsedAt() == null)
                .ifPresent(row -> startRegistration(
                        row.getEmail(),
                        row.getPasswordHash(),
                        row.getDisplayName(),
                        row.getGuestId(),
                        row.getGuestRoomId()));
    }

    /**
     * Redeems the six-digit code of a waiting sign-up. There is no session
     * yet, so the code is tied to the address instead; the attempt cap on the
     * row is what keeps six digits from being guessed.
     *
     * @return the spent sign-up, for the caller to create the account from
     */
    public PendingRegistration redeemRegistrationCode(String email, String rawCode) {
        String digits = rawCode == null ? "" : rawCode.replaceAll("\\s+", "");
        if (!digits.matches("\\d{6}")) {
            throw ApiException.badRequest("code_invalid", "That code should be six digits.");
        }
        if (email == null || email.isBlank()) {
            throw ApiException.badRequest("email_required", "Which address was the code sent to?");
        }
        if (pending.spendByCode(email, hash(digits), Instant.now(), MAX_CODE_ATTEMPTS) != 1) {
            pending.countFailedAttempt(email);
            int left = pending.findByEmailIgnoreCase(email)
                    .filter(row -> row.getUsedAt() == null && row.getExpiresAt().isAfter(Instant.now()))
                    .map(row -> MAX_CODE_ATTEMPTS - row.getAttempts())
                    .orElse(0);
            throw ApiException.badRequest(
                    "code_invalid",
                    left > 0
                            ? "That code is not right. " + left + (left == 1 ? " try left." : " tries left.")
                            : "That code has expired or had too many tries. Ask for a new code.");
        }
        return pending.findByEmailIgnoreCase(email)
                .orElseThrow(() -> ApiException.badRequest("code_invalid", "That sign-up is no longer waiting."));
    }

    /** Redeems the link from a sign-up email. */
    public PendingRegistration redeemRegistrationLink(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            throw ApiException.badRequest("verification_missing", "That link is missing its token.");
        }
        String tokenHash = hash(rawToken);
        if (pending.spendByToken(tokenHash, Instant.now()) != 1) {
            throw ApiException.badRequest(
                    "verification_invalid", "That link has expired or was already used. Sign up again.");
        }
        return pending.findByTokenHash(tokenHash)
                .orElseThrow(() -> ApiException.badRequest("verification_invalid", "That link is not valid."));
    }

    /** One email, two routes to the same row: the link suits a laptop, the code a phone. */
    private void sendCode(String email, String displayName, String code, String pathAndQuery) {
        String link = props.web().baseUrl().replaceAll("/+$", "") + pathAndQuery;
        mailer.send(email, "Confirm your email for WatchParty", """
                Hi %s,

                Your confirmation code is:

                    %s

                Or open this link instead:

                %s

                Either one works once, and expires in %d hours. If you did not
                sign up for WatchParty, you can ignore this message.
                """.formatted(displayName, code, link, props.verification().ttl().toHours()));
    }

    private static String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    /** Six digits, padded, so a leading zero is never dropped. */
    private static String randomCode() {
        return String.format("%06d", RANDOM.nextInt(1_000_000));
    }

    private static String randomValue() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** Only the hash is ever stored, so a database dump yields no usable links. */
    private static String hash(String raw) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return Base64.getEncoder().encodeToString(digest.digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable", ex);
        }
    }
}
