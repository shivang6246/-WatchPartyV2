package com.watchparty.security;

import com.watchparty.common.ApiException;
import com.watchparty.config.WebSocketConfig;
import com.watchparty.ratelimit.RateLimits;
import com.watchparty.ratelimit.RedisRateLimiter;
import com.watchparty.room.Room;
import com.watchparty.room.RoomMember;
import com.watchparty.room.RoomService;
import com.watchparty.sync.RoomWatchdog;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.lang.NonNull;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

/**
 * Authenticates and authorizes the STOMP session.
 *
 * <p>The CONNECT frame carries a single-use ticket, which is exchanged here for
 * a session principal. Membership is then resolved once and pinned to the
 * session, so the dominant message type — heartbeats — costs no database round
 * trip, while the frames that actually change a room re-check membership.
 */
@Component
public class StompAuthInterceptor implements ChannelInterceptor {

    private static final Logger log = LoggerFactory.getLogger(StompAuthInterceptor.class);

    public static final String ATTR_ROOM_ID = "roomId";
    public static final String ATTR_MEMBER_ID = "memberId";
    public static final String ATTR_IS_HOST = "isHost";

    private final WsTicketService tickets;
    private final RoomService roomService;
    private final RedisRateLimiter limiter;
    private final SessionRegistry sessionRegistry;
    private final RoomWatchdog watchdog;

    // The watchdog reaches the messaging template through the event publisher,
    // and the template is built from this interceptor's configuration, so it
    // is taken lazily to keep that from closing into a bean cycle.
    public StompAuthInterceptor(
            WsTicketService tickets,
            RoomService roomService,
            RedisRateLimiter limiter,
            SessionRegistry sessionRegistry,
            @Lazy RoomWatchdog watchdog) {
        this.tickets = tickets;
        this.roomService = roomService;
        this.limiter = limiter;
        this.sessionRegistry = sessionRegistry;
        this.watchdog = watchdog;
    }

    @Override
    public Message<?> preSend(@NonNull Message<?> message, @NonNull MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message;
        }

        switch (accessor.getCommand()) {
            case CONNECT -> authenticate(accessor);
            case SUBSCRIBE -> authorizeDestination(accessor, accessor.getDestination(), "/topic/room/");
            case SEND -> authorizeDestination(accessor, accessor.getDestination(), "/app/room/");
            default -> {
                // STOMP frames other than these carry no room scope.
            }
        }
        return message;
    }

    private void authenticate(StompHeaderAccessor accessor) {
        Map<String, Object> attributes = accessor.getSessionAttributes();
        String clientIp = attributes == null
                ? "unknown"
                : String.valueOf(attributes.getOrDefault(WebSocketConfig.ATTR_CLIENT_IP, "unknown"));

        var decision = limiter.consume(
                RateLimits.WS_CONNECT.bucket(),
                clientIp,
                RateLimits.WS_CONNECT.limit(),
                RateLimits.WS_CONNECT.window());
        if (!decision.allowed()) {
            throw ApiException.forbidden("rate_limited", "Too many connection attempts.");
        }

        WsTicketService.Redeemed redeemed = tickets.redeem(accessor.getFirstNativeHeader("ticket"));
        AuthPrincipal principal = redeemed.principal();

        Room room = roomService.requireRoomById(redeemed.roomId());
        RoomMember member = roomService.requireMember(room.getId(), principal);

        accessor.setUser(principal);
        if (attributes != null) {
            attributes.put(ATTR_ROOM_ID, room.getId());
            attributes.put(ATTR_MEMBER_ID, member.getId());
            attributes.put(ATTR_IS_HOST, member.isHost());
        }
        sessionRegistry.bind(accessor.getSessionId(), member.getId());
        if (watchdog.onMemberConnected(room.getId(), member)) {
            // Joining over REST put them on the roster; this is when they are
            // actually watching, so everyone's list shows them as present now.
            roomService.broadcastMembers(room);
        }
        log.debug("STOMP session opened for member {} in room {}", member.getId(), room.getId());
    }

    /**
     * A ticket is scoped to one room, and so is the session it opened: no
     * session may subscribe to or publish into any other room's destinations.
     */
    private void authorizeDestination(StompHeaderAccessor accessor, String destination, String roomPrefix) {
        if (destination == null) {
            return;
        }
        if (destination.startsWith("/user/") || destination.startsWith("/app/session/")) {
            return;
        }
        if (!destination.startsWith(roomPrefix)) {
            throw ApiException.forbidden("bad_destination", "Unknown destination.");
        }

        Map<String, Object> attributes = accessor.getSessionAttributes();
        Object sessionRoom = attributes == null ? null : attributes.get(ATTR_ROOM_ID);
        if (sessionRoom == null) {
            throw ApiException.unauthorized("not_connected", "This session has no room.");
        }

        String remainder = destination.substring(roomPrefix.length());
        int slash = remainder.indexOf('/');
        String roomId = slash < 0 ? remainder : remainder.substring(0, slash);
        try {
            if (!sessionRoom.equals(UUID.fromString(roomId))) {
                throw ApiException.forbidden("wrong_room", "That destination belongs to another room.");
            }
        } catch (IllegalArgumentException ex) {
            throw ApiException.forbidden("bad_destination", "Unknown destination.");
        }
    }
}
