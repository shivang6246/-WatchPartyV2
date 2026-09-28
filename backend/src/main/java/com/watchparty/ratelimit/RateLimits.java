package com.watchparty.ratelimit;

import java.time.Duration;

/**
 * Limits are per surface and keyed on the principal that surface actually
 * belongs to, rather than one uniform limit keyed on whatever is at hand.
 */
public final class RateLimits {

    public record Policy(String bucket, int limit, Duration window, Key key) {}

    public enum Key {
        IP,
        PRINCIPAL,
        MEMBER
    }

    public static final Policy LOGIN_BURST = new Policy("login", 5, Duration.ofMinutes(1), Key.IP);
    public static final Policy LOGIN_HOURLY = new Policy("login-hour", 20, Duration.ofHours(1), Key.IP);
    public static final Policy GUEST_ISSUE = new Policy("guest", 10, Duration.ofMinutes(1), Key.IP);
    // Sending mail costs money and annoys the recipient; redeeming is guessing.
    public static final Policy VERIFY_SEND = new Policy("verify-send", 5, Duration.ofHours(1), Key.PRINCIPAL);
    public static final Policy VERIFY_ATTEMPT = new Policy("verify-try", 20, Duration.ofHours(1), Key.IP);
    // A room code is enough to join, so looking one up is what a guesser does.
    public static final Policy ROOM_LOOKUP = new Policy("room-lookup", 20, Duration.ofMinutes(1), Key.IP);
    public static final Policy ROOM_CREATE = new Policy("room-create", 5, Duration.ofHours(1), Key.PRINCIPAL);
    /** Adding by email says whether an address has an account, so it is not free to repeat. */
    public static final Policy FRIEND_REQUEST = new Policy("friend-request", 30, Duration.ofHours(1), Key.PRINCIPAL);
    public static final Policy WS_TICKET = new Policy("ws-ticket", 10, Duration.ofMinutes(1), Key.PRINCIPAL);
    public static final Policy WS_CONNECT = new Policy("ws-connect", 5, Duration.ofMinutes(1), Key.IP);
    // Search spends someone else's quota, so it is limited per caller as well
    // as cached server-side.
    public static final Policy CATALOG_SEARCH = new Policy("catalog", 30, Duration.ofMinutes(1), Key.PRINCIPAL);

    // Realtime surfaces, enforced in the STOMP layer where the member is known.
    public static final Policy CHAT_SEND = new Policy("chat", 10, Duration.ofSeconds(10), Key.MEMBER);
    public static final Policy PLAYBACK_EVENT = new Policy("playback", 20, Duration.ofSeconds(10), Key.MEMBER);
    // Reactions are meant to be mashed, but every one fans out to the room.
    public static final Policy REACTION = new Policy("reaction", 15, Duration.ofSeconds(10), Key.MEMBER);
    // Clients send "typing" at most every few seconds; this only stops abuse.
    public static final Policy TYPING = new Policy("typing", 20, Duration.ofSeconds(10), Key.MEMBER);

    private RateLimits() {}
}
