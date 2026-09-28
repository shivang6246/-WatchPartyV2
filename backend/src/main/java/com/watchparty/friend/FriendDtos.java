package com.watchparty.friend;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class FriendDtos {

    /** The room a friend is in right now. */
    public record WatchingView(
            String code,
            String title,
            String platform,
            String videoTitle,
            String videoThumbnail,
            /** People present in that room, the friend included. */
            int watching) {}

    /** A friend, and the room they are in if they are watching and share it. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record FriendView(
            UUID userId,
            String displayName,
            String avatarUrl,
            Instant since,
            WatchingView watching) {}

    /** A request, either one this account received or one it sent. */
    public record RequestView(UUID id, UUID userId, String displayName, String avatarUrl, Instant createdAt) {}

    public record FriendsOverview(
            List<FriendView> friends,
            List<RequestView> incoming,
            List<RequestView> outgoing,
            boolean shareActivity) {}

    /** What the home screen polls: who is watching now, and whether anyone is waiting on you. */
    public record ActivityView(List<FriendView> watching, int incomingRequests, int friendCount) {}

    /**
     * Exactly one way of naming the person: their email, someone you are in a
     * room with ({@code roomId} and their {@code memberId}), or the code from
     * their friend link.
     */
    public record AddFriendRequest(
            @Email @Size(max = 320) String email,
            UUID roomId,
            UUID memberId,
            @Size(max = 16) String code) {}

    public record LinkView(String code) {}

    public record SettingsRequest(Boolean shareActivity) {}

    /** How this account relates to each registered member of one room: friend, outgoing or incoming. */
    public record RoomRelations(Map<UUID, String> members) {}

    private FriendDtos() {}
}
