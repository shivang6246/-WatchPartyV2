package com.watchparty.sync;

import com.watchparty.config.AppProperties;
import com.watchparty.metrics.WatchPartyMetrics;
import com.watchparty.room.RoomMember;
import com.watchparty.room.RoomMemberRepository;
import com.watchparty.room.RoomRepository;
import com.watchparty.room.RoomService;
import com.watchparty.room.Room;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Keeps a room from getting stuck when people drop.
 *
 * <p>Two deadlines, both held in Redis so any instance can act on them:
 *
 * <ul>
 *   <li><b>Host away.</b> A host whose socket goes starts a grace period rather
 *       than an immediate hand-off, because a phone switching networks looks
 *       exactly like leaving. If they are still gone when it runs out, the
 *       longest-standing registered member who is watching becomes host. If
 *       only guests are left, nobody can host (hosting needs an account), so
 *       the room is unlocked instead: guests can at least press play.
 *   <li><b>Room empty.</b> A room with nobody connected closes after its own,
 *       longer grace period. That is a decision, not a side effect of the 24h
 *       expiry, so an abandoned room gives its code back within minutes.
 * </ul>
 *
 * <p>Both are re-checked against live presence when they fall due, never
 * trusted blindly: a second tab, a reconnect or a heartbeat may have brought
 * the person back in the meantime.
 */
@Component
public class RoomWatchdog {

    private static final Logger log = LoggerFactory.getLogger(RoomWatchdog.class);

    private final RoomRepository rooms;
    private final RoomMemberRepository members;
    private final RoomService roomService;
    private final RoomStateService stateService;
    private final RoomEventPublisher events;
    private final WatchPartyMetrics metrics;
    private final AppProperties props;

    public RoomWatchdog(
            RoomRepository rooms,
            RoomMemberRepository members,
            RoomService roomService,
            RoomStateService stateService,
            RoomEventPublisher events,
            WatchPartyMetrics metrics,
            AppProperties props) {
        this.rooms = rooms;
        this.members = members;
        this.roomService = roomService;
        this.stateService = stateService;
        this.events = events;
        this.metrics = metrics;
        this.props = props;
    }

    // ---- Signals ----------------------------------------------------------

    /**
     * A member's socket opened: whatever was waiting on their absence stops.
     *
     * @return true when they were not present before, so the room hears they joined
     */
    public boolean onMemberConnected(UUID roomId, RoomMember member) {
        // Present from the moment the socket opens, not from the first
        // heartbeat five seconds later: a host who drops in that window must
        // still see this member as someone to hand the room to.
        boolean arrived = stateService.heartbeat(roomId, member.getId());
        stateService.cancelEmpty(roomId);
        if (member.isHost()) {
            if (stateService.cancelHostAway(roomId)) {
                events.publish(roomId, "members", Map.of("type", "host-back", "memberId", member.getId().toString()));
                log.info("Host {} is back in room {}", member.getId(), roomId);
            }
            relockForHost(roomId);
        }
        return arrived;
    }

    /**
     * Playback belongs to the host. The only time a room is open to everyone is
     * after its host was lost with nobody to promote; the moment a host is
     * back, it is theirs again. This also re-locks rooms unlocked by hand
     * before hosts lost the option.
     */
    private void relockForHost(UUID roomId) {
        RoomState state = stateService.read(roomId);
        if (state != null && !state.locked()) {
            stateService.setLocked(roomId, true);
            events.publish(roomId, "members", Map.of("type", "room", "room", Map.of("locked", true)));
            log.info("Room {} has its host back; playback is host-only again", roomId);
        }
    }

    /** A member's socket closed, or they left over REST. */
    public void onMemberGone(UUID roomId, UUID memberId) {
        Optional<Room> found = rooms.findById(roomId);
        if (found.isEmpty() || !found.get().isActive()) {
            return;
        }
        Room room = found.get();
        long now = System.currentTimeMillis();

        Set<UUID> present = stateService.presentMembers(roomId);
        if (present.isEmpty()) {
            if (stateService.scheduleEmpty(roomId, now + props.room().emptyGrace().toMillis())) {
                log.debug("Room {} is empty; closing in {}", room.getRoomCode(), props.room().emptyGrace());
            }
            // Nobody is there to take over, so a host hand-off would be pointless.
            return;
        }

        members.findByRoomIdAndUserId(roomId, room.getHostUserId())
                .filter(host -> host.getId().equals(memberId))
                .ifPresent(host -> startHostGrace(room, host, now));
    }

    private void startHostGrace(Room room, RoomMember host, long now) {
        long deadline = now + props.room().hostGrace().toMillis();
        if (stateService.scheduleHostAway(room.getId(), deadline)) {
            events.publish(room.getId(), "members", Map.of(
                    "type", "host-away",
                    "memberId", host.getId().toString(),
                    "deadline", deadline));
            log.info("Host {} dropped from room {}; handing over at {}", host.getId(), room.getRoomCode(), deadline);
        }
    }

    /**
     * Catches what a disconnect event misses: a laptop lid closing never sends
     * one, so the member only ages out of the presence set. Called for every
     * active room by the snapshot sweep.
     */
    public void audit(Room room) {
        // Heartbeats that stopped with no disconnect: tell the room they left.
        for (UUID gone : stateService.expirePresence(room.getId())) {
            events.publish(room.getId(), "members", Map.of("type", "left", "memberId", gone.toString()));
        }
        Set<UUID> present = stateService.presentMembers(room.getId());
        long now = System.currentTimeMillis();
        if (present.isEmpty()) {
            stateService.scheduleEmpty(room.getId(), now + props.room().emptyGrace().toMillis());
            return;
        }
        stateService.cancelEmpty(room.getId());
        members.findByRoomIdAndUserId(room.getId(), room.getHostUserId())
                .filter(host -> !present.contains(host.getId()))
                .ifPresent(host -> startHostGrace(room, host, now));
    }

    // ---- Presence ---------------------------------------------------------

    /**
     * Notices members whose heartbeats stopped without a disconnect (a dead
     * network, a closed lid) within seconds: their last heartbeat plus
     * {@code app.room.member-heartbeat-ttl}, plus at most one sweep. The
     * snapshot sweep's audit alone would take up to half a minute more. Only
     * rooms with someone in their presence set are walked, from Redis, so an
     * idle server does no work here.
     */
    @Scheduled(fixedDelayString = "${app.room.presence-sweep-ms:2000}")
    public void sweepPresence() {
        for (UUID roomId : stateService.roomsWithPresence()) {
            runSafely("presence sweep", roomId, () -> expirePresence(roomId));
        }
    }

    void expirePresence(UUID roomId) {
        Set<UUID> gone = stateService.expirePresence(roomId);
        for (UUID memberId : gone) {
            events.publish(roomId, "members", Map.of("type", "left", "memberId", memberId.toString()));
        }
        for (UUID memberId : gone) {
            // The same follow-up as a disconnect: a host hand-off, or an empty room.
            onMemberGone(roomId, memberId);
        }
        stateService.forgetIfEmpty(roomId);
    }

    // ---- Deadlines --------------------------------------------------------

    @Scheduled(fixedDelayString = "${app.room.watchdog-interval-ms:5000}")
    public void sweep() {
        long now = System.currentTimeMillis();
        for (UUID roomId : stateService.due(RoomStateService.HOST_AWAY_KEY, now)) {
            if (stateService.claim(RoomStateService.HOST_AWAY_KEY, roomId)) {
                runSafely("host failover", roomId, () -> failover(roomId));
            }
        }
        for (UUID roomId : stateService.due(RoomStateService.EMPTY_KEY, now)) {
            if (stateService.claim(RoomStateService.EMPTY_KEY, roomId)) {
                runSafely("empty-room close", roomId, () -> closeIfEmpty(roomId));
            }
        }
    }

    void failover(UUID roomId) {
        Optional<Room> found = rooms.findById(roomId);
        if (found.isEmpty() || !found.get().isActive()) {
            return;
        }
        Room room = found.get();
        Set<UUID> present = stateService.presentMembers(roomId);
        Optional<RoomMember> host = members.findByRoomIdAndUserId(roomId, room.getHostUserId());

        if (host.isPresent() && present.contains(host.get().getId())) {
            metrics.hostFailover("host_returned");
            events.publish(roomId, "members", Map.of("type", "host-back", "memberId", host.get().getId().toString()));
            return;
        }

        List<RoomMember> roster = members.findByRoomIdAndRemovedFalseOrderByJoinedAtAsc(roomId);
        Optional<RoomMember> successor = pickSuccessor(roster, present);
        if (successor.isPresent()) {
            roomService.transferHost(room, successor.get().getId(), "failover");
            metrics.hostFailover("transferred");
            return;
        }

        // Only guests are left. They cannot host, but they must not be stuck in
        // a room nobody can control either.
        metrics.hostFailover("no_candidate");
        RoomState state = stateService.read(roomId);
        if (state != null && state.locked()) {
            stateService.setLocked(roomId, false);
            events.publish(roomId, "members", Map.of(
                    "type", "room", "room", Map.of("locked", false)));
        }
        events.publish(roomId, "members", Map.of("type", "host-lost"));
        log.info("Room {} lost its host and has no registered member to promote", room.getRoomCode());
    }

    /**
     * The longest-standing registered member who is watching right now.
     *
     * @param roster members of the room ordered by when they joined, oldest first
     */
    public static Optional<RoomMember> pickSuccessor(List<RoomMember> roster, Set<UUID> present) {
        return roster.stream()
                .filter(m -> !m.isRemoved())
                .filter(m -> !m.isHost())
                .filter(m -> m.getUserId() != null)
                .filter(m -> present.contains(m.getId()))
                .findFirst();
    }

    void closeIfEmpty(UUID roomId) {
        Optional<Room> found = rooms.findById(roomId);
        if (found.isEmpty() || !found.get().isActive()) {
            return;
        }
        if (!stateService.presentMembers(roomId).isEmpty()) {
            return;
        }
        roomService.closeRoom(found.get(), "empty");
    }

    private static void runSafely(String what, UUID roomId, Runnable action) {
        try {
            action.run();
        } catch (RuntimeException ex) {
            log.warn("Watchdog {} failed for room {}", what, roomId, ex);
        }
    }
}
