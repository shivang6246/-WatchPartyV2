package com.watchparty.room;

import com.watchparty.common.AssignedIdEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** Append-only log: late-join reconstruction and abuse review. */
@Entity
@Table(name = "playback_event")
public class PlaybackEventEntity extends AssignedIdEntity {

    private UUID roomId;
    private UUID memberId;
    private String action;
    private long positionMs;
    private boolean playing;
    private float speed = 1.0f;
    private long sequenceNumber;
    private Instant serverTs = Instant.now();

    protected PlaybackEventEntity() {}

    public PlaybackEventEntity(
            UUID roomId,
            UUID memberId,
            String action,
            long positionMs,
            boolean playing,
            float speed,
            long sequenceNumber,
            Instant serverTs) {
        this.roomId = roomId;
        this.memberId = memberId;
        this.action = action;
        this.positionMs = positionMs;
        this.playing = playing;
        this.speed = speed;
        this.sequenceNumber = sequenceNumber;
        this.serverTs = serverTs;
    }

    public UUID getRoomId() {
        return roomId;
    }

    public long getSequenceNumber() {
        return sequenceNumber;
    }
}
