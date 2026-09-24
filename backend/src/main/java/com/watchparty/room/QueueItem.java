package com.watchparty.room;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.JsonAutoDetect.Visibility;
import java.time.Instant;
import java.util.UUID;

/**
 * One video waiting its turn, stored inside the room row's {@code queue}
 * jsonb column.
 *
 * <p>Serialised field by field, not through the getters: {@code getPlatform}
 * returns the enum while the stored value is its wire string, and the JSON
 * has to round-trip exactly.
 */
@JsonAutoDetect(
        fieldVisibility = Visibility.ANY,
        getterVisibility = Visibility.NONE,
        isGetterVisibility = Visibility.NONE,
        setterVisibility = Visibility.NONE)
public class QueueItem {

    private UUID itemId = UUID.randomUUID();
    private String platform;
    private String videoUrl;
    private String videoRef;
    private String title;
    private String thumbnail;
    private String author;
    private Long durationMs;
    private UUID addedByMemberId;
    /** Denormalised, like a chat author, so the queue renders without a lookup. */
    private String addedByName;
    private Instant addedAt = Instant.now();

    protected QueueItem() {}

    public QueueItem(
            VideoSource source,
            String title,
            String thumbnail,
            String author,
            Long durationMs,
            UUID addedByMemberId,
            String addedByName) {
        this.platform = source.platform().value();
        this.videoUrl = source.url();
        this.videoRef = source.ref();
        this.title = title;
        this.thumbnail = thumbnail == null && source.ref() != null && source.platform() == Platform.YOUTUBE
                ? "https://i.ytimg.com/vi/" + source.ref() + "/hqdefault.jpg"
                : thumbnail;
        this.author = author;
        this.durationMs = durationMs;
        this.addedByMemberId = addedByMemberId;
        this.addedByName = addedByName;
    }

    public UUID getItemId() {
        return itemId;
    }

    public Platform getPlatform() {
        return Platform.from(platform);
    }

    public String getVideoUrl() {
        return videoUrl;
    }

    public String getVideoRef() {
        return videoRef;
    }

    public String getTitle() {
        return title;
    }

    public String getThumbnail() {
        return thumbnail;
    }

    public String getAuthor() {
        return author;
    }

    public Long getDurationMs() {
        return durationMs;
    }

    public UUID getAddedByMemberId() {
        return addedByMemberId;
    }

    public String getAddedByName() {
        return addedByName;
    }

    public Instant getAddedAt() {
        return addedAt;
    }

    /**
     * Items never change after they are queued, so one is the same as another
     * with its id. This is also what lets Hibernate tell an untouched queue
     * from a changed one instead of rewriting the column on every save.
     */
    @Override
    public boolean equals(Object other) {
        return other instanceof QueueItem item && itemId.equals(item.itemId);
    }

    @Override
    public int hashCode() {
        return itemId.hashCode();
    }
}
