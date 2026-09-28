package com.watchparty.sync;

import com.watchparty.chat.ChatService;
import com.watchparty.common.ApiException;
import com.watchparty.room.Room;
import com.watchparty.room.RoomMember;
import com.watchparty.room.RoomService;
import com.watchparty.security.AuthPrincipal;
import com.watchparty.security.StompAuthInterceptor;
import java.security.Principal;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.stereotype.Controller;

/** The realtime surface: playback, chat, reactions, typing, heartbeats and clock probes. */
@Controller
public class RealtimeController {

    private static final Logger log = LoggerFactory.getLogger(RealtimeController.class);

    private final RoomService roomService;
    private final PlaybackService playbackService;
    private final ChatService chatService;

    public RealtimeController(RoomService roomService, PlaybackService playbackService, ChatService chatService) {
        this.roomService = roomService;
        this.playbackService = playbackService;
        this.chatService = chatService;
    }

    /**
     * The one path where a round trip is felt on every press, so the room row
     * is loaded only if the room turns out to be cold (see PlaybackService).
     */
    @MessageMapping("/room/{roomId}/playback")
    public void playback(
            @DestinationVariable UUID roomId, @Payload PlaybackMessage message, Principal principal) {
        AuthPrincipal caller = principal(principal);
        RoomMember member = roomService.requireMember(roomId, caller);
        playbackService.handle(roomId, () -> roomService.requireRoomById(roomId), member, message, caller.getName());
    }

    @MessageMapping("/room/{roomId}/chat")
    public void chat(@DestinationVariable UUID roomId, @Payload ChatInbound message, Principal principal) {
        AuthPrincipal caller = principal(principal);
        Room room = roomService.requireRoomById(roomId);
        RoomMember member = roomService.requireMember(roomId, caller);
        chatService.post(room, member, message.body(), caller.getName());
    }

    @MessageMapping("/room/{roomId}/reaction")
    public void reaction(@DestinationVariable UUID roomId, @Payload ReactionInbound message, Principal principal) {
        AuthPrincipal caller = principal(principal);
        Room room = roomService.requireRoomById(roomId);
        RoomMember member = roomService.requireMember(roomId, caller);
        chatService.react(room, member, message.emoji(), caller.getName());
    }

    @MessageMapping("/room/{roomId}/typing")
    public void typing(@DestinationVariable UUID roomId, @Payload TypingInbound message, Principal principal) {
        AuthPrincipal caller = principal(principal);
        Room room = roomService.requireRoomById(roomId);
        RoomMember member = roomService.requireMember(roomId, caller);
        chatService.typing(room, member, Boolean.TRUE.equals(message.typing()));
    }

    /**
     * Heartbeats are the dominant message volume, so this path reads the pinned
     * session membership instead of hitting the database every five seconds.
     */
    @MessageMapping("/room/{roomId}/heartbeat")
    public void heartbeat(
            @DestinationVariable UUID roomId,
            @Payload HeartbeatInbound message,
            SimpMessageHeaderAccessor accessor) {
        Map<String, Object> attributes = accessor.getSessionAttributes();
        if (attributes == null) {
            return;
        }
        Object memberId = attributes.get(StompAuthInterceptor.ATTR_MEMBER_ID);
        Object sessionRoom = attributes.get(StompAuthInterceptor.ATTR_ROOM_ID);
        if (memberId == null || !roomId.equals(sessionRoom)) {
            return;
        }
        boolean arrived = playbackService.heartbeat(
                roomId,
                (UUID) memberId,
                new PlaybackMessage(null, message.positionMs(), message.playing(), null, null, null, null, null),
                Boolean.TRUE.equals(message.buffering()));
        if (arrived) {
            roomService.broadcastMembers(roomId);
        }
        playbackService.recordCorrections(
                roomId, (UUID) memberId, message.rateCorrections(), message.seekCorrections(), message.resyncs());
    }

    /**
     * One leg of the clock exchange: the client sends t0, the server stamps t1,
     * the client notes t2 on arrival. Five probes are taken and the one with the
     * lowest round trip wins.
     */
    @MessageMapping("/session/time")
    @SendToUser("/queue/time")
    public ClockProbe time(@Payload ClockProbe probe) {
        return new ClockProbe(probe.t0(), System.currentTimeMillis());
    }

    /** Asks for the authoritative state, e.g. after a reconnect. */
    @MessageMapping("/room/{roomId}/resync")
    public void resync(@DestinationVariable UUID roomId, Principal principal) {
        AuthPrincipal caller = principal(principal);
        Room room = roomService.requireRoomById(roomId);
        roomService.requireMember(roomId, caller);
        playbackService.sendState(room, caller.getName());
    }

    @MessageExceptionHandler
    @SendToUser("/queue/errors")
    public Map<String, Object> handleException(Exception ex) {
        if (ex instanceof ApiException apiException) {
            return Map.of("code", apiException.code(), "message", apiException.getMessage());
        }
        log.error("Realtime frame failed", ex);
        return Map.of("code", "internal_error", "message", "That action could not be completed.");
    }

    private static AuthPrincipal principal(Principal principal) {
        if (principal instanceof AuthPrincipal caller) {
            return caller;
        }
        throw ApiException.unauthorized("not_connected", "This session is not authenticated.");
    }

    public record ChatInbound(String body) {}

    /**
     * The correction counts are how many times this client reached each tier of
     * the drift ladder since its previous heartbeat. Telemetry only.
     */
    public record HeartbeatInbound(
            Long positionMs,
            Boolean playing,
            Boolean buffering,
            Integer rateCorrections,
            Integer seekCorrections,
            Integer resyncs) {}

    public record ReactionInbound(String emoji) {}

    public record TypingInbound(Boolean typing) {}

    public record ClockProbe(Long t0, Long t1) {}
}
