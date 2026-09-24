package com.watchparty.sync;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.watchparty.security.SessionRegistry;
import java.time.Duration;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * Fans room events out across app instances.
 *
 * <p>Spring's simple broker only reaches sessions on its own JVM, so with more
 * than one instance two members of the same room can be connected to different
 * instances and never see each other's events — a silent, total failure of the
 * product. Everything therefore goes out through Redis, and each instance
 * delivers to its own sessions when the message comes back, including the
 * instance that published it. That keeps the path identical whether one
 * instance is running or four.
 */
@Component
public class RoomEventPublisher {

    private static final Logger log = LoggerFactory.getLogger(RoomEventPublisher.class);

    /**
     * A single channel: at stage-2 scale every instance filtering every room is
     * far cheaper than ref-counted per-room subscriptions, and stage 3 replaces
     * this with an external STOMP relay rather than growing it.
     */
    public static final String CHANNEL = "wp:room-events";

    private final StringRedisTemplate redis;
    private final SimpMessagingTemplate messaging;
    private final ObjectMapper objectMapper;
    private final SessionRegistry sessions;

    // The messaging template comes from the WebSocket configuration, which in
    // turn needs the interceptor and so the room services: taking it lazily is
    // what keeps that from closing into a bean cycle.
    public RoomEventPublisher(
            StringRedisTemplate redis,
            @Lazy SimpMessagingTemplate messaging,
            ObjectMapper objectMapper,
            SessionRegistry sessions) {
        this.redis = redis;
        this.messaging = messaging;
        this.objectMapper = objectMapper;
        this.sessions = sessions;
    }

    public void publish(UUID roomId, String topic, Object payload) {
        fanOut(new Target(roomId.toString(), topic, null, null), payload);
    }

    /**
     * Reaches one member's own error queue wherever their socket is, unlike
     * {@link #sendError}, which only reaches sessions on this instance.
     */
    public void sendToMember(UUID roomId, String principalName, Object payload) {
        fanOut(new Target(roomId.toString(), null, principalName, null), payload);
    }

    /**
     * Tells a member why, then closes their sockets on every instance. Used for
     * a kick, where rejecting their frames alone would leave them subscribed.
     */
    public void disconnectMember(UUID roomId, UUID memberId, String principalName, Object payload) {
        fanOut(new Target(roomId.toString(), null, principalName, memberId.toString()), payload);
    }

    private void fanOut(Target target, Object payload) {
        try {
            String body = objectMapper.writeValueAsString(payload);
            String envelope = objectMapper.writeValueAsString(new Envelope(
                    target.roomId(), target.topic(), body, target.principalName(), target.disconnectMemberId()));
            redis.convertAndSend(CHANNEL, envelope);
        } catch (JsonProcessingException ex) {
            log.error("Failed to serialise room event for {}", target.roomId(), ex);
        } catch (RuntimeException ex) {
            // Redis is down: still serve the members on this instance rather than
            // dropping the event entirely.
            log.warn("Redis fan-out failed for room {}; delivering locally only", target.roomId(), ex);
            deliverLocally(target, payload);
        }
    }

    /** Called by the subscriber on every instance, including the publisher. */
    void deliverLocally(Target target, Object payload) {
        if (target.principalName() != null) {
            messaging.convertAndSendToUser(target.principalName(), "/queue/errors", payload);
        } else {
            messaging.convertAndSend("/topic/room/" + target.roomId() + "/" + target.topic(), payload);
        }
        if (target.disconnectMemberId() != null) {
            sessions.closeMember(
                    UUID.fromString(target.disconnectMemberId()), SessionRegistry.REMOVED, Duration.ofMillis(500));
        }
    }

    /** Errors are session-scoped, so they never leave the instance that raised them. */
    public void sendError(String principalName, Object payload) {
        messaging.convertAndSendToUser(principalName, "/queue/errors", payload);
    }

    /**
     * The wire shape on {@link #CHANNEL}. The last two fields are absent on a
     * room broadcast, which keeps it readable by an instance on an older build.
     */
    public record Envelope(
            String roomId, String topic, String payload, String principalName, String disconnectMemberId) {

        Target target() {
            return new Target(roomId, topic, principalName, disconnectMemberId);
        }
    }

    record Target(String roomId, String topic, String principalName, String disconnectMemberId) {}
}
