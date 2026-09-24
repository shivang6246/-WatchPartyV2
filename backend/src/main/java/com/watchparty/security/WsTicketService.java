package com.watchparty.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.watchparty.common.ApiException;
import com.watchparty.config.AppProperties;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * Single-use tickets for the WebSocket handshake.
 *
 * <p>A browser cannot set headers on a WebSocket handshake. The usual
 * workaround puts the JWT in the query string, where it lands in load balancer
 * logs, proxy logs and browser history. Instead the client asks for a ticket,
 * which is valid for 30 seconds and exactly one connection, and presents it in
 * the STOMP CONNECT frame.
 */
@Service
public class WsTicketService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final Duration ttl;

    public WsTicketService(StringRedisTemplate redis, ObjectMapper objectMapper, AppProperties props) {
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.ttl = props.wsTicket().ttl();
    }

    private static String key(String ticket) {
        return "ws:ticket:" + ticket;
    }

    public Issued issue(AuthPrincipal principal, UUID roomId) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String ticket = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        try {
            String payload = objectMapper.writeValueAsString(
                    new Stored(principal.id().toString(), principal.kind().name(), principal.displayName(),
                            roomId.toString()));
            redis.opsForValue().set(key(ticket), payload, ttl);
        } catch (Exception ex) {
            throw new ApiException(
                    org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "ticket_unavailable",
                    "Could not issue a connection ticket.");
        }
        return new Issued(ticket, ttl.toSeconds());
    }

    /** Redeems a ticket; the read and the delete are one operation, so it cannot be replayed. */
    public Redeemed redeem(String ticket) {
        if (ticket == null || ticket.isBlank()) {
            throw ApiException.unauthorized("ticket_missing", "No connection ticket was presented.");
        }
        String payload = redis.opsForValue().getAndDelete(key(ticket));
        if (payload == null) {
            throw ApiException.unauthorized("ticket_invalid", "Connection ticket is invalid, used or expired.");
        }
        try {
            Stored stored = objectMapper.readValue(payload, Stored.class);
            AuthPrincipal principal = new AuthPrincipal(
                    UUID.fromString(stored.id()),
                    PrincipalKind.valueOf(stored.kind()),
                    stored.displayName(),
                    PrincipalKind.valueOf(stored.kind()) == PrincipalKind.GUEST
                            ? UUID.fromString(stored.roomId())
                            : null);
            return new Redeemed(principal, UUID.fromString(stored.roomId()));
        } catch (Exception ex) {
            throw ApiException.unauthorized("ticket_invalid", "Connection ticket could not be read.");
        }
    }

    public record Issued(String ticket, long expiresInSeconds) {}

    public record Redeemed(AuthPrincipal principal, UUID roomId) {}

    private record Stored(String id, String kind, String displayName, String roomId) {}
}
