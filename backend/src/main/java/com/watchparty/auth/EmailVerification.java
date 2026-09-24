package com.watchparty.auth;

import com.watchparty.common.AssignedIdEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * One emailed verification link. Stored as a hash only and single-use, like a
 * refresh token; issuing a new one invalidates whatever came before it.
 */
@Entity
@Table(name = "email_verification")
public class EmailVerification extends AssignedIdEntity {

    private UUID userId;
    private String tokenHash;
    /** The six-digit code from the same email, hashed like the link. */
    private String codeHash;
    /** Wrong codes tried against this row; a few kill it, so guessing is bounded. */
    private int attempts;
    /** The address it was sent to: changing the address invalidates the link. */
    private String email;
    private Instant createdAt = Instant.now();
    private Instant expiresAt;
    private Instant usedAt;

    protected EmailVerification() {}

    public EmailVerification(UUID userId, String tokenHash, String codeHash, String email, Instant expiresAt) {
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.codeHash = codeHash;
        this.email = email;
        this.expiresAt = expiresAt;
    }

    public int getAttempts() {
        return attempts;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getEmail() {
        return email;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getUsedAt() {
        return usedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
