package com.watchparty.auth;

import com.watchparty.auth.AuthDtos.AuthResponse;
import com.watchparty.auth.AuthDtos.ConfirmRegistrationRequest;
import com.watchparty.auth.AuthDtos.LoginRequest;
import com.watchparty.auth.AuthDtos.RegisterRequest;
import com.watchparty.auth.AuthDtos.UserView;
import com.watchparty.common.ApiException;
import com.watchparty.ratelimit.RedisRateLimiter;
import com.watchparty.room.RoomMember;
import com.watchparty.room.RoomMemberRepository;
import com.watchparty.security.AuthPrincipal;
import com.watchparty.security.JwtService;
import com.watchparty.user.AppUser;
import com.watchparty.user.AppUserRepository;
import java.time.Duration;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final AppUserRepository users;
    private final RoomMemberRepository members;
    private final RefreshTokenService refreshTokens;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder;
    private final RedisRateLimiter limiter;
    private final EmailVerificationService verification;

    public AuthService(
            AppUserRepository users,
            RoomMemberRepository members,
            RefreshTokenService refreshTokens,
            JwtService jwtService,
            PasswordEncoder passwordEncoder,
            RedisRateLimiter limiter,
            EmailVerificationService verification) {
        this.users = users;
        this.members = members;
        this.refreshTokens = refreshTokens;
        this.jwtService = jwtService;
        this.passwordEncoder = passwordEncoder;
        this.limiter = limiter;
        this.verification = verification;
    }

    /**
     * Registers an account.
     *
     * <p>Where verification is enforced, no account is created here: the
     * sign-up waits until the emailed code or link is confirmed through
     * {@link #confirmRegistration}, and the result carries no session.
     * Elsewhere (no SMTP configured) the account is created straight away.
     *
     * <p>If the caller is currently a guest in a room, their existing member
     * row is rebound to the new account rather than a second participant
     * appearing.
     */
    public Registration register(RegisterRequest request, AuthPrincipal currentGuest) {
        String email = normaliseEmail(request.email());
        if (users.existsByEmailIgnoreCase(email)) {
            throw ApiException.conflict("email_taken", "That email is already registered.");
        }
        String passwordHash = passwordEncoder.encode(request.password());
        String displayName = request.displayName().trim();
        boolean inRoom = currentGuest != null && currentGuest.isGuest() && currentGuest.roomId() != null;

        if (verification.required()) {
            verification.startRegistration(
                    email,
                    passwordHash,
                    displayName,
                    inRoom ? currentGuest.id() : null,
                    inRoom ? currentGuest.roomId() : null);
            return Registration.pending(email);
        }

        AppUser user = AppUser.local(email, passwordHash, displayName);
        users.save(user);

        if (inRoom) {
            linkGuestMembership(currentGuest.roomId(), currentGuest.id(), user);
        }
        // A failure here must not lose the account: they can ask for the link
        // again from the banner.
        try {
            verification.issue(user);
        } catch (RuntimeException ex) {
            log.warn("Could not send the verification email for user {}", user.getId(), ex);
        }
        log.info("Registered user {}", user.getId());
        return Registration.signedIn(session(user));
    }

    /**
     * Finishes a held sign-up with its code (plus the address it went to) or
     * its link, creates the account already confirmed, and signs it in.
     */
    public Session confirmRegistration(ConfirmRegistrationRequest request) {
        PendingRegistration signup = request.token() != null && !request.token().isBlank()
                ? verification.redeemRegistrationLink(request.token())
                : verification.redeemRegistrationCode(
                        request.email() == null ? null : normaliseEmail(request.email()), request.code());

        // The address may have been taken meanwhile, e.g. by a Google sign-in.
        if (users.existsByEmailIgnoreCase(signup.getEmail())) {
            throw ApiException.conflict("email_taken", "That email is already registered. Sign in instead.");
        }
        AppUser user = AppUser.local(signup.getEmail(), signup.getPasswordHash(), signup.getDisplayName());
        user.markEmailVerified();
        try {
            users.save(user);
        } catch (DataIntegrityViolationException race) {
            throw ApiException.conflict("email_taken", "That email is already registered. Sign in instead.");
        }
        if (signup.getGuestId() != null && signup.getGuestRoomId() != null) {
            linkGuestMembership(signup.getGuestRoomId(), signup.getGuestId(), user);
        }
        log.info("Registered user {} after confirming their email address", user.getId());
        return session(user);
    }

    /** Sends a new code for a sign-up that is still waiting. */
    public void resendRegistration(String email) {
        String normalised = normaliseEmail(email);
        // The IP limit is in the filter; this one stops a single address
        // being flooded from many.
        var decision = limiter.consume("register-resend", normalised, 5, Duration.ofHours(1));
        if (!decision.allowed()) {
            throw new ApiException(
                    org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                    "rate_limited",
                    "Too many codes for this address. Try again later.");
        }
        verification.resendRegistration(normalised);
    }

    private void linkGuestMembership(UUID roomId, UUID guestId, AppUser user) {
        Optional<RoomMember> existing = members.findByRoomIdAndGuestId(roomId, guestId);
        if (existing.isEmpty()) {
            return;
        }
        if (members.findByRoomIdAndUserId(roomId, user.getId()).isPresent()) {
            // Already in the room under the account; leave both rows alone
            // rather than colliding with the per-room uniqueness constraint.
            return;
        }
        RoomMember member = existing.get();
        member.promoteToUser(user.getId());
        members.save(member);
        log.info("Guest {} kept their place in room {} as user {}", guestId, roomId, user.getId());
    }

    public Session login(LoginRequest request) {
        String email = normaliseEmail(request.email());

        // The IP-keyed limit lives in the filter; this one is keyed on the
        // account, so spraying one password across many addresses still stalls.
        var decision = limiter.consume("login-email", email, 10, Duration.ofMinutes(5));
        if (!decision.allowed()) {
            throw new ApiException(
                    org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                    "rate_limited",
                    "Too many attempts for this account. Try again shortly.");
        }

        AppUser user = users.findByEmailIgnoreCase(email)
                .orElseThrow(() -> ApiException.unauthorized("bad_credentials", "Email or password is incorrect."));
        if (!"local".equals(user.getProvider()) || user.getPasswordHash() == null) {
            throw ApiException.badRequest("use_provider", "This account signs in with Google.");
        }
        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw ApiException.unauthorized("bad_credentials", "Email or password is incorrect.");
        }
        return session(user);
    }

    public Session refresh(String rawRefreshToken) {
        RefreshTokenService.Rotation rotation = refreshTokens.rotate(rawRefreshToken);
        AppUser user = rotation.user();
        return new Session(
                new AuthResponse(jwtService.issueAccessToken(user), jwtService.accessTtlSeconds(), view(user)),
                rotation.refreshToken());
    }

    public void logout(String rawRefreshToken) {
        refreshTokens.revokeByRawToken(rawRefreshToken);
    }

    public Session session(AppUser user) {
        String refresh = refreshTokens.issueNewFamily(user);
        return new Session(
                new AuthResponse(jwtService.issueAccessToken(user), jwtService.accessTtlSeconds(), view(user)),
                refresh);
    }

    public UserView view(AppUser user) {
        return new UserView(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                user.getAvatarUrl(),
                user.getProvider(),
                user.isEmailVerified(),
                verification.required());
    }

    /** Sends the verification link again, e.g. from the banner in the web client. */
    public void resendVerification(AppUser user) {
        if (user.isEmailVerified()) {
            throw ApiException.conflict("already_verified", "That address is already confirmed.");
        }
        verification.issue(user);
    }

    private static String normaliseEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    public record Session(AuthResponse response, String refreshToken) {}

    /** Either a signed-in session, or a sign-up waiting on the address named. */
    public record Registration(Session session, String pendingEmail) {
        static Registration signedIn(Session session) {
            return new Registration(session, null);
        }

        static Registration pending(String email) {
            return new Registration(null, email);
        }
    }
}
