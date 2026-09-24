package com.watchparty.auth;

import com.watchparty.common.AssignedIdEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * One issued refresh token. Stored as a hash only, and single-use: presenting
 * one that has already been spent invalidates its whole family, which turns a
 * stolen cookie from a permanent compromise into a single detected event.
 */
@Entity
@Table(name = "refresh_token")
public class RefreshToken extends AssignedIdEntity {

    private UUID userId;
    private String tokenHash;
    private UUID familyId;
    private Instant issuedAt = Instant.now();
    private Instant expiresAt;
    private Instant usedAt;
    private Instant revokedAt;

    protected RefreshToken() {}

    public RefreshToken(UUID userId, String tokenHash, UUID familyId, Instant expiresAt) {
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.familyId = familyId;
        this.expiresAt = expiresAt;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getFamilyId() {
        return familyId;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getUsedAt() {
        return usedAt;
    }

    public Instant getRevokedAt() {
        return revokedAt;
    }

    public boolean isUsable() {
        return usedAt == null && revokedAt == null && expiresAt.isAfter(Instant.now());
    }
}
