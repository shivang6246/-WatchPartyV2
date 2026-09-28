package com.watchparty.friend;

import com.watchparty.common.AssignedIdEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * Two accounts, pending (one asked) or accepted (both agreed). One row per
 * pair: {@code userLow} and {@code userHigh} are the pair in a fixed order, so
 * either side's request finds the same row. See {@link FriendService#pair}.
 */
@Entity
@Table(name = "friendship")
public class Friendship extends AssignedIdEntity {

    static final String PENDING = "pending";
    static final String ACCEPTED = "accepted";

    private UUID userLow;
    private UUID userHigh;
    private UUID requestedBy;
    private String status = PENDING;
    private Instant createdAt = Instant.now();
    private Instant acceptedAt;

    protected Friendship() {}

    /** A request from {@code from}, or with {@code accepted}, a friendship both sides already agreed to. */
    static Friendship between(UUID from, UUID to, boolean accepted) {
        UUID[] pair = FriendService.pair(from, to);
        Friendship friendship = new Friendship();
        friendship.userLow = pair[0];
        friendship.userHigh = pair[1];
        friendship.requestedBy = from;
        if (accepted) {
            friendship.accept();
        }
        return friendship;
    }

    void accept() {
        status = ACCEPTED;
        acceptedAt = Instant.now();
    }

    boolean isAccepted() {
        return ACCEPTED.equals(status);
    }

    boolean involves(UUID userId) {
        return userLow.equals(userId) || userHigh.equals(userId);
    }

    /** The other account in the pair. */
    UUID other(UUID userId) {
        return userLow.equals(userId) ? userHigh : userLow;
    }

    UUID getRequestedBy() {
        return requestedBy;
    }

    Instant getCreatedAt() {
        return createdAt;
    }

    Instant getAcceptedAt() {
        return acceptedAt;
    }
}
