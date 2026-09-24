package com.watchparty.chat;

import com.watchparty.common.ApiException;
import com.watchparty.metrics.WatchPartyMetrics;
import com.watchparty.ratelimit.RateLimits;
import com.watchparty.ratelimit.RedisRateLimiter;
import com.watchparty.room.ChatMessage;
import com.watchparty.room.ChatMessageRepository;
import com.watchparty.room.Room;
import com.watchparty.room.RoomDtos.ChatMessageView;
import com.watchparty.room.RoomDtos.ChatPage;
import com.watchparty.room.RoomMember;
import com.watchparty.sync.RoomEventPublisher;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

/**
 * Chat, plus the two ephemeral signals that ride alongside it: reactions and
 * typing indicators.
 *
 * <p>Those two go out on the room's {@code activity} topic, not {@code chat}.
 * The chat topic carries exactly one shape, a stored message, and the Chrome
 * extension renders whatever arrives there. Nothing on {@code activity} is
 * stored, so a client that misses an event loses nothing.
 */
@Service
public class ChatService {

    private static final int MAX_BODY = 500;

    /**
     * A fixed set, validated server-side: a free-form field fanned out to every
     * member is a spam and payload channel waiting to happen.
     */
    public static final Set<String> REACTIONS = Set.of(
            "👍", // thumbs up
            "😂", // tears of joy
            "😮", // open mouth
            "😢", // crying
            "❤️", // red heart
            "🔥", // fire
            "👏", // clapping
            "🎉"); // party popper

    private final ChatMessageRepository messages;
    private final RoomEventPublisher events;
    private final RedisRateLimiter limiter;
    private final WatchPartyMetrics metrics;

    public ChatService(
            ChatMessageRepository messages,
            RoomEventPublisher events,
            RedisRateLimiter limiter,
            WatchPartyMetrics metrics) {
        this.messages = messages;
        this.events = events;
        this.limiter = limiter;
        this.metrics = metrics;
    }

    /**
     * Bodies are stored as text and rendered as text; nothing in a chat message
     * is ever interpreted as markup by a client.
     */
    public void post(Room room, RoomMember member, String rawBody, String principalName) {
        if (member.isMuted()) {
            events.sendError(principalName, Map.of("code", "muted", "message", "The host has muted you."));
            return;
        }
        String body = rawBody == null ? "" : rawBody.strip();
        if (body.isEmpty()) {
            return;
        }
        if (body.length() > MAX_BODY) {
            body = body.substring(0, MAX_BODY);
        }

        var decision = limiter.consume(
                RateLimits.CHAT_SEND.bucket(),
                member.getId().toString(),
                RateLimits.CHAT_SEND.limit(),
                RateLimits.CHAT_SEND.window());
        if (!decision.allowed()) {
            events.sendError(principalName, Map.of("code", "rate_limited", "message", "You are sending too fast."));
            return;
        }

        ChatMessage saved = messages.save(
                new ChatMessage(room.getId(), member.getId(), member.getDisplayName(), body));
        events.publish(
                room.getId(),
                "chat",
                new ChatMessageView(
                        saved.getId(), member.getId(), member.getDisplayName(), saved.getBody(),
                        saved.getCreatedAt()));
        metrics.chatMessage();
        // Sending a message ends "typing" without the client having to say so.
        publishTyping(room.getId(), member, false);
    }

    /** A floating emoji over the video. Not stored; a muted member cannot send one. */
    public void react(Room room, RoomMember member, String emoji, String principalName) {
        if (member.isMuted()) {
            events.sendError(principalName, Map.of("code", "muted", "message", "The host has muted you."));
            return;
        }
        if (emoji == null || !REACTIONS.contains(emoji)) {
            events.sendError(principalName, Map.of("code", "bad_reaction", "message", "Unknown reaction."));
            return;
        }
        var decision = limiter.consume(
                RateLimits.REACTION.bucket(),
                member.getId().toString(),
                RateLimits.REACTION.limit(),
                RateLimits.REACTION.window());
        if (!decision.allowed()) {
            // Silently: a burst hitting the cap is not worth a banner.
            return;
        }
        Map<String, Object> event = new HashMap<>();
        event.put("type", "reaction");
        event.put("id", UUID.randomUUID().toString());
        event.put("memberId", member.getId().toString());
        event.put("displayName", member.getDisplayName());
        event.put("emoji", emoji);
        event.put("serverTs", System.currentTimeMillis());
        events.publish(room.getId(), "activity", event);
        metrics.reaction();
    }

    /**
     * Relays "is typing". Clients refresh it every few seconds while typing and
     * expire it themselves after a few seconds of silence, so a lost "stopped"
     * never leaves an indicator stuck on.
     */
    public void typing(Room room, RoomMember member, boolean typing) {
        if (member.isMuted()) {
            return;
        }
        var decision = limiter.consume(
                RateLimits.TYPING.bucket(),
                member.getId().toString(),
                RateLimits.TYPING.limit(),
                RateLimits.TYPING.window());
        if (!decision.allowed()) {
            return;
        }
        publishTyping(room.getId(), member, typing);
    }

    private void publishTyping(UUID roomId, RoomMember member, boolean typing) {
        events.publish(roomId, "activity", Map.of(
                "type", "typing",
                "memberId", member.getId().toString(),
                "displayName", member.getDisplayName(),
                "typing", typing));
    }

    /** Chat pages backwards, keyed on {@code before} rather than an offset. */
    public ChatPage history(UUID roomId, Instant before, int limit) {
        int size = Math.min(Math.max(limit, 1), 100);
        Instant cursor = before == null ? Instant.now() : before;
        List<ChatMessage> page = messages.findByRoomIdAndCreatedAtBeforeOrderByCreatedAtDesc(
                roomId, cursor, PageRequest.of(0, size));
        List<ChatMessageView> views = page.stream()
                .map(m -> new ChatMessageView(
                        m.getId(), m.getMemberId(), m.getDisplayName(), m.getBody(), m.getCreatedAt()))
                .toList();
        Instant next = page.size() < size ? null : page.get(page.size() - 1).getCreatedAt();
        return new ChatPage(views.reversed(), next);
    }

    public static void requireBody(String body) {
        if (body == null || body.isBlank()) {
            throw ApiException.badRequest("empty_message", "A message needs a body.");
        }
    }
}
