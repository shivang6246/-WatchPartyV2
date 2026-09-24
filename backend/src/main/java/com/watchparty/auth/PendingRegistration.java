package com.watchparty.auth;

import com.watchparty.common.AssignedIdEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A sign-up whose address has not been confirmed yet. The account itself is
 * only created when the emailed code or link comes back; until then this row
 * holds what register was given, with the password already hashed.
 */
@Entity
@Table(name = "pending_registration")
public class PendingRegistration extends AssignedIdEntity {

    private String email;
    private String passwordHash;
    private String displayName;
    private String tokenHash;
    private String codeHash;
    private int attempts;
    private UUID guestId;
    private UUID guestRoomId;
    private Instant createdAt = Instant.now();
    private Instant expiresAt;
    private Instant usedAt;

    protected PendingRegistration() {}

    public PendingRegistration(
            String email,
            String passwordHash,
            String displayName,
            String tokenHash,
            String codeHash,
            UUID guestId,
            UUID guestRoomId,
            Instant expiresAt) {
        this.email = email;
        this.passwordHash = passwordHash;
        this.displayName = displayName;
        this.tokenHash = tokenHash;
        this.codeHash = codeHash;
        this.guestId = guestId;
        this.guestRoomId = guestRoomId;
        this.expiresAt = expiresAt;
    }

    public String getEmail() {
        return email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public String getDisplayName() {
        return displayName;
    }

    public int getAttempts() {
        return attempts;
    }

    public UUID getGuestId() {
        return guestId;
    }

    public UUID getGuestRoomId() {
        return guestRoomId;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getUsedAt() {
        return usedAt;
    }
}
