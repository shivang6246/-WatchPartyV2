package com.watchparty.room;

import com.watchparty.common.AssignedIdEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A room.
 *
 * <p>The playback fields here are a periodic snapshot, not the live value:
 * while a room is running, position, play flag and sequence number are
 * authoritative in Redis and are written back every 30 seconds and on close.
 *
 * <p>The current video lives in the {@code video*} fields and {@code queue}
 * holds only what comes after it, so advancing is the same operation as the
 * host changing the video by hand.
 *
 * <p>Every change to an existing room goes through {@code RoomService.mutate},
 * which locks the row for the length of one short transaction. Writers are
 * serialised, so a host edit, a queue advance and the snapshot sweep can
 * never undo one another. {@link DynamicUpdate} keeps each UPDATE to the
 * columns that actually changed.
 */
@Entity
@Table(name = "room")
@DynamicUpdate
public class Room extends AssignedIdEntity {

    private String roomCode;

    /** 128 bits of randomness: what the host's share link carries. */
    private String inviteToken;

    private UUID hostUserId;
    private String title = "Watch Party";
    private String platform = Platform.YOUTUBE.value();

    private String videoUrl;
    /** Provider-specific id, e.g. the YouTube video id. */
    private String videoRef;
    /** Denormalised from the catalogue so a room card needs no second lookup. */
    private String videoTitle;
    private String videoThumbnail;
    private String videoAuthor;
    private Long durationMs;

    private long positionMs;
    private boolean playing;
    private float speed = 1.0f;
    private long sequenceNumber;
    private Instant anchorTs = Instant.now();

    /**
     * Identifies what is playing now. A queue advance names the item it expects
     * to replace, so members whose players all end at once advance it once.
     */
    private UUID currentItemId;

    /**
     * Upcoming videos, in order. Always replaced with a new list rather than
     * changed in place, so Hibernate sees the change.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<QueueItem> queue = new ArrayList<>();

    // Host-only playback by default: members watch, the host drives. The host
    // can unlock it from the room menu to hand play/pause/seek to everyone.
    private boolean locked = true;
    private boolean active = true;
    private String visibility = "invite";
    private int maxMembers = 25;

    private Instant createdAt = Instant.now();
    private Instant updatedAt = Instant.now();
    private Instant expiresAt = Instant.now().plusSeconds(86400);
    private Instant closedAt;

    protected Room() {}

    public Room(String roomCode, String inviteToken, UUID hostUserId, String title, Platform platform, int maxMembers) {
        this.roomCode = roomCode;
        this.inviteToken = inviteToken;
        this.hostUserId = hostUserId;
        this.title = title;
        this.platform = platform.value();
        this.maxMembers = maxMembers;
    }

    public String getRoomCode() {
        return roomCode;
    }

    public String getInviteToken() {
        return inviteToken;
    }

    public void setInviteToken(String inviteToken) {
        this.inviteToken = inviteToken;
    }

    public UUID getHostUserId() {
        return hostUserId;
    }

    public void setHostUserId(UUID hostUserId) {
        this.hostUserId = hostUserId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public Platform getPlatform() {
        return Platform.from(platform);
    }

    public void setPlatform(Platform platform) {
        this.platform = platform.value();
    }

    public String getVideoUrl() {
        return videoUrl;
    }

    public void setVideoUrl(String videoUrl) {
        this.videoUrl = videoUrl;
    }

    public String getVideoRef() {
        return videoRef;
    }

    public void setVideoRef(String videoRef) {
        this.videoRef = videoRef;
    }

    public String getVideoTitle() {
        return videoTitle;
    }

    public void setVideoTitle(String videoTitle) {
        this.videoTitle = videoTitle;
    }

    public String getVideoThumbnail() {
        return videoThumbnail;
    }

    public void setVideoThumbnail(String videoThumbnail) {
        this.videoThumbnail = videoThumbnail;
    }

    public String getVideoAuthor() {
        return videoAuthor;
    }

    public void setVideoAuthor(String videoAuthor) {
        this.videoAuthor = videoAuthor;
    }

    public Long getDurationMs() {
        return durationMs;
    }

    public void setDurationMs(Long durationMs) {
        this.durationMs = durationMs;
    }

    public long getPositionMs() {
        return positionMs;
    }

    public void setPositionMs(long positionMs) {
        this.positionMs = positionMs;
    }

    public boolean isPlaying() {
        return playing;
    }

    public void setPlaying(boolean playing) {
        this.playing = playing;
    }

    public float getSpeed() {
        return speed;
    }

    public void setSpeed(float speed) {
        this.speed = speed;
    }

    public long getSequenceNumber() {
        return sequenceNumber;
    }

    public void setSequenceNumber(long sequenceNumber) {
        this.sequenceNumber = sequenceNumber;
    }

    public Instant getAnchorTs() {
        return anchorTs;
    }

    public void setAnchorTs(Instant anchorTs) {
        this.anchorTs = anchorTs;
    }

    public UUID getCurrentItemId() {
        return currentItemId;
    }

    public void setCurrentItemId(UUID currentItemId) {
        this.currentItemId = currentItemId;
    }

    public List<QueueItem> getQueue() {
        return queue == null ? List.of() : List.copyOf(queue);
    }

    public void setQueue(List<QueueItem> queue) {
        this.queue = new ArrayList<>(queue);
    }

    public boolean isLocked() {
        return locked;
    }

    public void setLocked(boolean locked) {
        this.locked = locked;
    }

    public boolean isActive() {
        return active;
    }

    public String getVisibility() {
        return visibility;
    }

    public void setVisibility(String visibility) {
        this.visibility = visibility;
    }

    public int getMaxMembers() {
        return maxMembers;
    }

    public void setMaxMembers(int maxMembers) {
        this.maxMembers = maxMembers;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void touch() {
        this.updatedAt = Instant.now();
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(Instant expiresAt) {
        this.expiresAt = expiresAt;
    }

    public Instant getClosedAt() {
        return closedAt;
    }

    /** Closing releases the room code for reuse; see the partial unique index. */
    public void close() {
        this.active = false;
        this.closedAt = Instant.now();
        this.playing = false;
        touch();
    }
}
