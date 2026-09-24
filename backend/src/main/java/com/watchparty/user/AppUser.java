package com.watchparty.user;

import com.watchparty.common.AssignedIdEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;

/** A registered account, local or federated. */
@Entity
@Table(name = "app_user")
public class AppUser extends AssignedIdEntity {

    private String email;
    private String passwordHash;
    private String displayName;
    private String provider = "local";
    private String providerId;
    private String avatarUrl;
    private Instant createdAt = Instant.now();
    private Instant deletedAt;
    /** Null until the address is confirmed; Google accounts arrive confirmed. */
    private Instant emailVerifiedAt;

    protected AppUser() {}

    public static AppUser local(String email, String passwordHash, String displayName) {
        AppUser user = new AppUser();
        user.email = email;
        user.passwordHash = passwordHash;
        user.displayName = displayName;
        user.provider = "local";
        return user;
    }

    public static AppUser google(String email, String providerId, String displayName, String avatarUrl) {
        AppUser user = new AppUser();
        user.email = email;
        user.displayName = displayName;
        user.provider = "google";
        user.providerId = providerId;
        user.avatarUrl = avatarUrl;
        // Google has already proven the address belongs to them.
        user.emailVerifiedAt = Instant.now();
        return user;
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

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getProvider() {
        return provider;
    }

    public String getProviderId() {
        return providerId;
    }

    public String getAvatarUrl() {
        return avatarUrl;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getDeletedAt() {
        return deletedAt;
    }

    public Instant getEmailVerifiedAt() {
        return emailVerifiedAt;
    }

    public boolean isEmailVerified() {
        return emailVerifiedAt != null;
    }

    public void markEmailVerified() {
        this.emailVerifiedAt = Instant.now();
    }
}
