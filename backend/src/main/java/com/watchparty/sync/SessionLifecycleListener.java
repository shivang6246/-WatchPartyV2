package com.watchparty.sync;

import com.watchparty.security.SessionRegistry;
import com.watchparty.security.StompAuthInterceptor;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

/**
 * Presence bookkeeping for sockets that go away.
 *
 * <p>A clean disconnect is handled here; a laptop lid closing is not, which is
 * why presence also ages out of the heartbeat set on its own and the snapshot
 * sweep asks the {@link RoomWatchdog} to audit every room.
 */
@Component
public class SessionLifecycleListener {

    private static final Logger log = LoggerFactory.getLogger(SessionLifecycleListener.class);

    private final RoomStateService stateService;
    private final RoomEventPublisher events;
    private final RoomWatchdog watchdog;
    private final SessionRegistry sessions;

    public SessionLifecycleListener(
            RoomStateService stateService, RoomEventPublisher events, RoomWatchdog watchdog, SessionRegistry sessions) {
        this.stateService = stateService;
        this.events = events;
        this.watchdog = watchdog;
        this.sessions = sessions;
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(event.getMessage());
        Map<String, Object> attributes = accessor.getSessionAttributes();
        if (attributes == null) {
            return;
        }
        Object roomId = attributes.get(StompAuthInterceptor.ATTR_ROOM_ID);
        Object memberId = attributes.get(StompAuthInterceptor.ATTR_MEMBER_ID);
        if (!(roomId instanceof UUID room) || !(memberId instanceof UUID member)) {
            return;
        }
        if (sessions.hasOtherSession(member, accessor.getSessionId())) {
            // One of two tabs closed: they are still here. (A tab on another
            // instance is not seen from here; its next heartbeat puts them back.)
            log.debug("Member {} closed one of several sessions in room {}", member, room);
            return;
        }
        stateService.removePresence(room, member);
        events.publish(room, "members", Map.of("type", "left", "memberId", member.toString()));
        try {
            watchdog.onMemberGone(room, member);
        } catch (RuntimeException ex) {
            log.warn("Watchdog could not process disconnect of {} from {}", member, room, ex);
        }
        log.debug("Member {} disconnected from room {}", member, room);
    }
}
