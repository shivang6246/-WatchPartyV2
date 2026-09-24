package com.watchparty.auth;

import com.watchparty.common.ApiException;
import com.watchparty.config.AppProperties;
import com.watchparty.user.AppUser;
import com.watchparty.user.AppUserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** Rotating refresh tokens with reuse detection. */
@Service
public class RefreshTokenService {

    private static final Logger log = LoggerFactory.getLogger(RefreshTokenService.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final RefreshTokenRepository tokens;
    private final AppUserRepository users;
    private final AppProperties props;

    public RefreshTokenService(RefreshTokenRepository tokens, AppUserRepository users, AppProperties props) {
        this.tokens = tokens;
        this.users = users;
        this.props = props;
    }

    /** Starts a new token family, i.e. a new sign-in. */
    public String issueNewFamily(AppUser user) {
        return issue(user.getId(), UUID.randomUUID());
    }

    public String issue(UUID userId, UUID familyId) {
        String raw = randomValue();
        tokens.save(new RefreshToken(userId, hash(raw), familyId, Instant.now().plus(props.refresh().ttl())));
        return raw;
    }

    /**
     * Exchanges a refresh token for a fresh pair.
     *
     * <p>The spend is a single guarded UPDATE (see {@link RefreshTokenRepository#spend}),
     * so two racing requests cannot both rotate the same token: one wins and
     * the other is treated as a replay.
     *
     * @throws ApiException if the token is unknown, expired, revoked, or has
     *     already been spent, in which case the whole family is revoked
     */
    public Rotation rotate(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            throw ApiException.unauthorized("refresh_missing", "No refresh token was presented.");
        }
        String tokenHash = hash(rawToken);

        RefreshToken spent = tokens.spend(tokenHash, Instant.now()) == 1
                ? tokens.findByTokenHash(tokenHash).orElse(null)
                : null;

        if (spent == null) {
            // Either it never existed, or it is a replay of a token already
            // spent. A replay means a copy is in circulation, so the family goes.
            tokens.findByTokenHash(tokenHash).ifPresent(existing -> {
                revokeFamily(existing.getFamilyId());
                log.warn("Refresh token reuse detected for family {}; family revoked", existing.getFamilyId());
            });
            throw ApiException.unauthorized("refresh_invalid", "Session has expired. Please sign in again.");
        }

        AppUser user = users.findById(spent.getUserId())
                .orElseThrow(() -> ApiException.unauthorized("unknown_user", "Account not found."));
        String next = issue(user.getId(), spent.getFamilyId());
        return new Rotation(user, next);
    }

    public void revokeFamily(UUID familyId) {
        tokens.revokeFamily(familyId, Instant.now());
    }

    /** Revokes the family the presented token belongs to, if it is still known. */
    public void revokeByRawToken(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            return;
        }
        tokens.findByTokenHash(hash(rawToken)).ifPresent(token -> revokeFamily(token.getFamilyId()));
    }

    public List<RefreshToken> family(UUID familyId) {
        return tokens.findByFamilyId(familyId);
    }

    private static String randomValue() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** Only the hash is ever stored, so a database dump yields no usable tokens. */
    private static String hash(String raw) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return Base64.getEncoder().encodeToString(digest.digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable", ex);
        }
    }

    public record Rotation(AppUser user, String refreshToken) {}
}
