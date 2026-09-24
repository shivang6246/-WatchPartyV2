package com.watchparty.room;

import com.watchparty.common.AssignedIdEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A chat message.
 *
 * <p>The author's display name is denormalised onto the message: a sent
 * message keeps the name it was sent under, and a chat page renders with no
 * join against the member table.
 */
@Entity
@Table(name = "chat_message")
public class ChatMessage extends AssignedIdEntity {

    private UUID roomId;
    private UUID memberId;
    private String displayName;
    /** Stored as text and rendered as text; never interpreted as markup. */
    private String body;
    private Instant createdAt = Instant.now();

    protected ChatMessage() {}

    public ChatMessage(UUID roomId, UUID memberId, String displayName, String body) {
        this.roomId = roomId;
        this.memberId = memberId;
        this.displayName = displayName;
        this.body = body;
    }

    public UUID getRoomId() {
        return roomId;
    }

    public UUID getMemberId() {
        return memberId;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getBody() {
        return body;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
