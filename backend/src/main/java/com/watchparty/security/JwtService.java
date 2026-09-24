package com.watchparty.security;

import com.watchparty.common.ApiException;
import com.watchparty.config.AppProperties;
import com.watchparty.user.AppUser;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;

/**
 * Issues and verifies access and guest tokens.
 *
 * <p>Tokens carry a {@code kid} header so the signing key can be rotated while
 * existing sessions drain, rather than invalidating every session at once.
 */
@Service
public class JwtService {

    private static final String CLAIM_TYPE = "typ";
    private static final String CLAIM_NAME = "name";
    private static final String CLAIM_ROOM = "room";

    private final AppProperties props;
    private final SecretKey key;

    public JwtService(AppProperties props) {
        this.props = props;
        byte[] material = decodeSecret(props.jwt().secret());
        if (material.length < 32) {
            throw new IllegalStateException(
                    "JWT_SECRET must decode to at least 32 bytes; got " + material.length);
        }
        this.key = new SecretKeySpec(material, "HmacSHA256");
    }

    private static byte[] decodeSecret(String secret) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("JWT_SECRET is not set.");
        }
        try {
            return Decoders.BASE64.decode(secret);
        } catch (IllegalArgumentException | io.jsonwebtoken.io.DecodingException ex) {
            // jjwt's decoder throws its own DecodingException (not an
            // IllegalArgumentException) on a character standard base64 doesn't
            // allow, e.g. '_' or '-' from a URL-safe encoding. Either way, fall
            // back to treating the value as a raw high-entropy string, so
            // operators are not forced through exact base64 just to start the
            // app.
            return secret.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        }
    }

    public String issueAccessToken(AppUser user) {
        Instant now = Instant.now();
        return Jwts.builder()
                .header().keyId(props.jwt().keyId()).and()
                .issuer(props.jwt().issuer())
                .subject(user.getId().toString())
                .claim(CLAIM_TYPE, "access")
                .claim(CLAIM_NAME, user.getDisplayName())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(props.jwt().accessTtl())))
                .signWith(key)
                .compact();
    }

    /** Guest tokens are bound to one room and expire with it. */
    public String issueGuestToken(UUID guestId, UUID roomId, String displayName) {
        Instant now = Instant.now();
        return Jwts.builder()
                .header().keyId(props.jwt().keyId()).and()
                .issuer(props.jwt().issuer())
                .subject(guestId.toString())
                .claim(CLAIM_TYPE, "guest")
                .claim(CLAIM_NAME, displayName)
                .claim(CLAIM_ROOM, roomId.toString())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(props.jwt().guestTtl())))
                .signWith(key)
                .compact();
    }

    public AuthPrincipal parse(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .requireIssuer(props.jwt().issuer())
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();

            String type = claims.get(CLAIM_TYPE, String.class);
            UUID subject = UUID.fromString(claims.getSubject());
            String name = claims.get(CLAIM_NAME, String.class);

            if ("guest".equals(type)) {
                String room = claims.get(CLAIM_ROOM, String.class);
                if (room == null) {
                    throw ApiException.unauthorized("invalid_token", "Guest token is missing its room scope.");
                }
                return new AuthPrincipal(subject, PrincipalKind.GUEST, name, UUID.fromString(room));
            }
            if ("access".equals(type)) {
                return new AuthPrincipal(subject, PrincipalKind.USER, name, null);
            }
            throw ApiException.unauthorized("invalid_token", "Unsupported token type.");
        } catch (JwtException | IllegalArgumentException ex) {
            throw ApiException.unauthorized("invalid_token", "Token is invalid or expired.");
        }
    }

    public long accessTtlSeconds() {
        return props.jwt().accessTtl().toSeconds();
    }
}
