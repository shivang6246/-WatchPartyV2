package com.watchparty.room;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.watchparty.sync.PlaybackMessage;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Request and response shapes for the room surface. */
public final class RoomDtos {

    /**
     * Video metadata comes from the in-app catalogue, so a room can render a
     * card with a title and thumbnail without anyone re-resolving the link.
     */
    public record CreateRoomRequest(
            @Size(max = 120) String title,
            @NotBlank String platform,
            @Size(max = 2048) String videoUrl,
            @Size(max = 200) String videoTitle,
            @Size(max = 2048) String videoThumbnail,
            @Size(max = 120) String videoAuthor,
            Long durationMs,
            @Min(2) @Max(200) Integer maxMembers,
            String visibility) {}

    public record JoinRoomRequest(@Size(max = 40) String displayName, String inviteToken) {}

    /** Every field is optional; only the ones present are applied. */
    public record PatchRoomRequest(
            @Size(max = 120) String title,
            String platform,
            @Size(max = 2048) String videoUrl,
            @Size(max = 200) String videoTitle,
            @Size(max = 2048) String videoThumbnail,
            @Size(max = 120) String videoAuthor,
            Long durationMs,
            Boolean locked,
            UUID transferHostToMemberId,
            UUID removeMemberId,
            UUID muteMemberId,
            Boolean muted,
            Boolean rotateInviteToken) {}

    /** A video to add to the queue, in the same shape the "+" picker produces. */
    public record AddQueueRequest(
            @NotBlank String platform,
            @Size(max = 2048) String videoUrl,
            @Size(max = 200) String videoTitle,
            @Size(max = 2048) String videoThumbnail,
            @Size(max = 120) String videoAuthor,
            Long durationMs) {}

    /** The full queue in its new order: every current item id, once each. */
    public record ReorderQueueRequest(@NotNull List<UUID> itemIds) {}

    /**
     * @param reason "ended" when a member's player reached the end, which any
     *     member may report and the server checks against the projection; or
     *     "skip", which is a host action
     * @param ifCurrent the item the caller believes is playing; the advance is
     *     a no-op if something else already replaced it
     */
    public record AdvanceQueueRequest(String reason, UUID ifCurrent) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record QueueItemView(
            UUID id,
            String platform,
            String videoUrl,
            String videoRef,
            String title,
            String thumbnail,
            String author,
            Long durationMs,
            UUID addedByMemberId,
            String addedByName,
            Instant addedAt) {

        public static QueueItemView of(QueueItem item) {
            return new QueueItemView(
                    item.getItemId(),
                    item.getPlatform().value(),
                    item.getVideoUrl(),
                    item.getVideoRef(),
                    item.getTitle(),
                    item.getThumbnail(),
                    item.getAuthor(),
                    item.getDurationMs(),
                    item.getAddedByMemberId(),
                    item.getAddedByName(),
                    item.getAddedAt());
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record MemberView(
            UUID id,
            String displayName,
            String avatarUrl,
            String role,
            boolean guest,
            boolean present,
            boolean muted,
            Instant joinedAt) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record RoomView(
            UUID id,
            String code,
            String title,
            String platform,
            String videoUrl,
            String videoRef,
            String videoTitle,
            String videoThumbnail,
            String videoAuthor,
            boolean locked,
            boolean active,
            int maxMembers,
            Instant expiresAt,
            UUID hostMemberId,
            /** Present only for the host, who is the one who shares it. */
            String inviteToken,
            UUID selfMemberId,
            String selfRole,
            List<MemberView> members,
            PlaybackMessage playback,
            long serverTs,
            UUID currentItemId,
            List<QueueItemView> queue,
            /** Set while a disconnected host's grace period runs: when it ends. */
            Long hostAwayUntil) {}

    /** What an invited stranger may see before holding any token. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record RoomPreview(
            String code,
            String title,
            String platform,
            String videoTitle,
            String videoThumbnail,
            boolean locked,
            boolean active,
            int memberCount) {}

    /** A room tile on the home screen. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record RoomCard(
            UUID id,
            String code,
            String title,
            String platform,
            String videoTitle,
            String videoThumbnail,
            boolean host,
            int memberCount,
            Instant updatedAt) {}

    public record ChatMessageView(UUID id, UUID memberId, String displayName, String body, Instant createdAt) {}

    public record ChatPage(List<ChatMessageView> messages, Instant nextBefore) {}

    public record WsTicketRequest(UUID roomId) {}

    public record WsTicketResponse(String ticket, long expiresInSeconds) {}

    private RoomDtos() {}
}
