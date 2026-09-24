package com.watchparty.room;

import com.watchparty.common.AssignedIdEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * Membership of one room. Exactly one of {@code userId} or {@code guestId} is
 * set. This document, not the JWT, is what authorizes any room action.
 */
@Entity
@Table(name = "room_member")
public class RoomMember extends AssignedIdEntity {

    private UUID roomId;
    private UUID userId;
    private UUID guestId;
    private String displayName;
    private String avatarUrl;
    private String role = MemberRole.MEMBER.value();
    private Instant joinedAt = Instant.now();
    private Instant leftAt;
    private boolean removed;
    private boolean muted;

    protected RoomMember() {}

    public static RoomMember forUser(UUID roomId, UUID userId, String displayName, MemberRole role) {
        RoomMember member = new RoomMember();
        member.roomId = roomId;
        member.userId = userId;
        member.displayName = displayName;
        member.role = role.value();
        return member;
    }

    public static RoomMember forGuest(UUID roomId, UUID guestId, String displayName) {
        RoomMember member = new RoomMember();
        member.roomId = roomId;
        member.guestId = guestId;
        member.displayName = displayName;
        member.role = MemberRole.MEMBER.value();
        return member;
    }

    public UUID getRoomId() {
        return roomId;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getGuestId() {
        return guestId;
    }

    /**
     * Rebinds a guest row to a real account when someone registers mid-room, so
     * they keep their place rather than appearing twice.
     */
    public void promoteToUser(UUID accountId) {
        this.userId = accountId;
        this.guestId = null;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getAvatarUrl() {
        return avatarUrl;
    }

    public void setAvatarUrl(String avatarUrl) {
        this.avatarUrl = avatarUrl;
    }

    public MemberRole getRole() {
        return MemberRole.from(role);
    }

    public void setRole(MemberRole role) {
        this.role = role.value();
    }

    public boolean isHost() {
        return getRole() == MemberRole.HOST;
    }

    public Instant getJoinedAt() {
        return joinedAt;
    }

    public Instant getLeftAt() {
        return leftAt;
    }

    public void markLeft() {
        this.leftAt = Instant.now();
    }

    public void markRejoined() {
        this.leftAt = null;
    }

    public boolean isRemoved() {
        return removed;
    }

    public void setRemoved(boolean removed) {
        this.removed = removed;
    }

    public boolean isMuted() {
        return muted;
    }

    public void setMuted(boolean muted) {
        this.muted = muted;
    }
}
