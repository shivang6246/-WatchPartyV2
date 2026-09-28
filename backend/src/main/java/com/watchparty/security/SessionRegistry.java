package com.watchparty.security;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

/**
 * The WebSocket sessions this instance holds, and which room member each one
 * belongs to.
 *
 * <p>This is what makes a kick real. Rejecting a removed member's frames is not
 * enough on its own: their subscriptions keep delivering the room's chat and
 * playback until the socket goes away. So a removal fans out to every instance
 * and each one closes whatever sessions it holds for that member.
 */
@Component
public class SessionRegistry {

    private static final Logger log = LoggerFactory.getLogger(SessionRegistry.class);

    /** Application close code: the client must not reconnect. */
    public static final CloseStatus REMOVED = new CloseStatus(4001, "removed");

    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, UUID> memberBySession = new ConcurrentHashMap<>();

    private final ScheduledExecutorService closer = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "ws-session-closer");
        thread.setDaemon(true);
        return thread;
    });

    public void register(WebSocketSession session) {
        sessions.put(session.getId(), session);
    }

    public void unregister(WebSocketSession session) {
        sessions.remove(session.getId());
        memberBySession.remove(session.getId());
    }

    /** Called once the STOMP CONNECT frame has resolved the session's member. */
    public void bind(String sessionId, UUID memberId) {
        if (sessionId != null && memberId != null) {
            memberBySession.put(sessionId, memberId);
        }
    }

    public int size() {
        return sessions.size();
    }

    /**
     * Whether this member still has another open session on this instance: a
     * second tab, say. Their leaving one tab is then not them leaving the room.
     */
    public boolean hasOtherSession(UUID memberId, String exceptSessionId) {
        for (Map.Entry<String, UUID> entry : memberBySession.entrySet()) {
            if (!entry.getValue().equals(memberId) || entry.getKey().equals(exceptSessionId)) {
                continue;
            }
            WebSocketSession session = sessions.get(entry.getKey());
            if (session != null && session.isOpen()) {
                return true;
            }
        }
        return false;
    }

    /**
     * Closes every local session held by one member after {@code delay}, which
     * gives the explanatory error frame already queued for them time to leave.
     *
     * @return how many sessions were scheduled for closing
     */
    public int closeMember(UUID memberId, CloseStatus status, Duration delay) {
        int scheduled = 0;
        for (Map.Entry<String, UUID> entry : memberBySession.entrySet()) {
            if (!entry.getValue().equals(memberId)) {
                continue;
            }
            WebSocketSession session = sessions.get(entry.getKey());
            if (session == null) {
                continue;
            }
            scheduled++;
            closer.schedule(() -> close(session, status), delay.toMillis(), TimeUnit.MILLISECONDS);
        }
        return scheduled;
    }

    private static void close(WebSocketSession session, CloseStatus status) {
        try {
            if (session.isOpen()) {
                session.close(status);
            }
        } catch (IOException ex) {
            log.debug("Closing session {} failed", session.getId(), ex);
        }
    }
}
