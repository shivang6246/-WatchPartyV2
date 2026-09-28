package com.watchparty.sync;

import com.watchparty.config.AppProperties;
import com.watchparty.metrics.WatchPartyMetrics;
import com.watchparty.room.Room;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Service;

/**
 * Hot playback state, held in Redis.
 *
 * <p>Position, play flag and sequence number change several times a minute per
 * active room. A database write per change does not survive past a few
 * hundred rooms, so they live here and are snapshotted back periodically by
 * {@link StateSnapshotJob}. Losing up to one snapshot interval of playback
 * position in a Redis failure is acceptable; losing chat or membership is not,
 * which is why neither of those is ever Redis-only.
 */
@Service
public class RoomStateService {

    private static final String F_POSITION = "position";
    private static final String F_PLAYING = "playing";
    private static final String F_SPEED = "speed";
    private static final String F_ANCHOR = "anchor";
    private static final String F_DURATION = "duration";
    private static final String F_LOCKED = "locked";
    private static final String F_SEQ = "seq";

    /**
     * Assigning the sequence and writing the new state has to be one step: two
     * members seeking at the same instant must come out strictly ordered, with
     * no negotiation round between clients.
     */
    private static final String APPLY_SCRIPT = String.join("\n",
            "local key = KEYS[1]",
            "if redis.call('EXISTS', key) == 0 then return -1 end",
            "local seq = redis.call('HINCRBY', key, 'seq', 1)",
            "redis.call('HSET', key, 'position', ARGV[1], 'playing', ARGV[2], 'speed', ARGV[3], 'anchor', ARGV[4])",
            "if ARGV[5] ~= '' then redis.call('HSET', key, 'duration', ARGV[5]) end",
            "redis.call('PEXPIRE', key, ARGV[6])",
            "return seq");

    /**
     * Deadlines the watchdog acts on, as sorted sets of room ids scored by the
     * epoch millis they fall due. Global rather than per room so a sweep is one
     * range read, and shared by every instance: whichever removes an entry
     * first is the one that acts on it.
     */
    static final String HOST_AWAY_KEY = "wp:watch:host-away";

    static final String EMPTY_KEY = "wp:watch:room-empty";

    /** Rooms whose presence set is not known to be empty; see {@link #roomsWithPresence}. */
    static final String LIVE_ROOMS_KEY = "wp:presence:rooms";

    /** Claims the aged-out members of one presence set: returns them and removes them in one step. */
    private static final String EXPIRE_SCRIPT = """
            local stale = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
            if #stale > 0 then
              redis.call('ZREM', KEYS[1], unpack(stale))
            end
            return stale
            """;

    private final StringRedisTemplate redis;
    private final RedisScript<Long> applyScript;
    @SuppressWarnings("rawtypes")
    private final RedisScript<List> expireScript;
    private final Duration stateTtl;
    private final Duration heartbeatTtl;
    private final WatchPartyMetrics metrics;

    public RoomStateService(StringRedisTemplate redis, AppProperties props, WatchPartyMetrics metrics) {
        this.redis = redis;
        this.applyScript = new DefaultRedisScript<>(APPLY_SCRIPT, Long.class);
        this.expireScript = new DefaultRedisScript<>(EXPIRE_SCRIPT, List.class);
        this.stateTtl = props.room().ttl();
        this.heartbeatTtl = props.room().memberHeartbeatTtl();
        this.metrics = metrics;
    }

    private static String stateKey(UUID roomId) {
        return "room:" + roomId + ":state";
    }

    private static String membersKey(UUID roomId) {
        return "room:" + roomId + ":members";
    }

    /** Reads live state, seeding it from the database snapshot on a cold room. */
    public RoomState load(Room room) {
        RoomState state = read(room.getId());
        return state != null ? state : hydrate(room);
    }

    public RoomState read(UUID roomId) {
        Map<Object, Object> raw = redis.opsForHash().entries(stateKey(roomId));
        if (raw == null || raw.isEmpty()) {
            return null;
        }
        return new RoomState(
                roomId,
                asLong(raw.get(F_POSITION), 0),
                "1".equals(String.valueOf(raw.get(F_PLAYING))),
                asFloat(raw.get(F_SPEED)),
                asLong(raw.get(F_ANCHOR), System.currentTimeMillis()),
                raw.get(F_DURATION) == null ? null : asLong(raw.get(F_DURATION), 0),
                "1".equals(String.valueOf(raw.get(F_LOCKED))),
                asLong(raw.get(F_SEQ), 0));
    }

    /** Writes the database snapshot into Redis and returns it. */
    public RoomState hydrate(Room room) {
        String key = stateKey(room.getId());
        Map<String, String> values = new HashMap<>();
        values.put(F_POSITION, String.valueOf(room.getPositionMs()));
        // A cold room always resumes paused: nobody should walk in and find
        // playback already running from a stale anchor.
        values.put(F_PLAYING, "0");
        values.put(F_SPEED, String.valueOf(room.getSpeed()));
        values.put(F_ANCHOR, String.valueOf(System.currentTimeMillis()));
        values.put(F_LOCKED, room.isLocked() ? "1" : "0");
        values.put(F_SEQ, String.valueOf(room.getSequenceNumber()));
        if (room.getDurationMs() != null) {
            values.put(F_DURATION, String.valueOf(room.getDurationMs()));
        }
        redis.opsForHash().putAll(key, values);
        redis.expire(key, stateTtl);
        return read(room.getId());
    }

    /**
     * Applies an accepted event: anchors it at {@code anchor} (server clock, see
     * {@link RoomState#anchorFor}), assigns the next sequence and stores the
     * result.
     *
     * @return the new authoritative state, or null if the room is not loaded
     */
    public RoomState apply(UUID roomId, long positionMs, boolean playing, float speed, Long durationMs, long anchor) {
        Long seq = metrics.timeApply(() -> redis.execute(
                applyScript,
                List.of(stateKey(roomId)),
                String.valueOf(positionMs),
                playing ? "1" : "0",
                String.valueOf(speed),
                String.valueOf(anchor),
                durationMs == null ? "" : String.valueOf(durationMs),
                String.valueOf(stateTtl.toMillis())));
        if (seq == null || seq < 0) {
            return null;
        }
        return read(roomId);
    }

    /**
     * Starts a room over on a new video: zero, paused, same lock.
     *
     * <p>The sequence carries on from whichever is higher, the live one or the
     * snapshot, plus one. Seeding it from the snapshot alone would hand out a
     * number clients have already seen, and they would drop the reset.
     * Presence is left alone, so the roster does not blink empty.
     */
    public RoomState resetPlayback(Room room) {
        RoomState live = read(room.getId());
        long seq = Math.max(live == null ? 0 : live.sequence(), room.getSequenceNumber()) + 1;
        boolean locked = live == null ? room.isLocked() : live.locked();

        String key = stateKey(room.getId());
        redis.delete(List.of(key, healthKey(room.getId())));
        Map<String, String> values = new HashMap<>();
        values.put(F_POSITION, "0");
        values.put(F_PLAYING, "0");
        values.put(F_SPEED, "1.0");
        values.put(F_ANCHOR, String.valueOf(System.currentTimeMillis()));
        values.put(F_LOCKED, locked ? "1" : "0");
        values.put(F_SEQ, String.valueOf(seq));
        if (room.getDurationMs() != null) {
            values.put(F_DURATION, String.valueOf(room.getDurationMs()));
        }
        redis.opsForHash().putAll(key, values);
        redis.expire(key, stateTtl);
        return read(room.getId());
    }

    public void setLocked(UUID roomId, boolean locked) {
        redis.opsForHash().put(stateKey(roomId), F_LOCKED, locked ? "1" : "0");
    }

    public void clear(UUID roomId) {
        redis.delete(List.of(stateKey(roomId), membersKey(roomId), healthKey(roomId)));
        cancelHostAway(roomId);
        cancelEmpty(roomId);
    }

    private static String healthKey(UUID roomId) {
        return "room:" + roomId + ":health";
    }

    // ---- Watchdog deadlines -----------------------------------------------

    /** @return true if this call started the grace period, false if one was running */
    public boolean scheduleHostAway(UUID roomId, long deadlineMs) {
        return Boolean.TRUE.equals(redis.opsForZSet().addIfAbsent(HOST_AWAY_KEY, roomId.toString(), deadlineMs));
    }

    /** @return true if a grace period was running and is now cancelled */
    public boolean cancelHostAway(UUID roomId) {
        Long removed = redis.opsForZSet().remove(HOST_AWAY_KEY, roomId.toString());
        return removed != null && removed > 0;
    }

    /** When the host's grace period runs out, or null if none is running. */
    public Long hostAwayDeadline(UUID roomId) {
        Double score = redis.opsForZSet().score(HOST_AWAY_KEY, roomId.toString());
        return score == null ? null : score.longValue();
    }

    public boolean scheduleEmpty(UUID roomId, long deadlineMs) {
        return Boolean.TRUE.equals(redis.opsForZSet().addIfAbsent(EMPTY_KEY, roomId.toString(), deadlineMs));
    }

    public boolean cancelEmpty(UUID roomId) {
        Long removed = redis.opsForZSet().remove(EMPTY_KEY, roomId.toString());
        return removed != null && removed > 0;
    }

    /** Rooms whose deadline in {@code key} has passed, oldest first. */
    public List<UUID> due(String key, long nowMs) {
        Set<String> ids = redis.opsForZSet().rangeByScore(key, 0, nowMs, 0, 100);
        List<UUID> result = new ArrayList<>();
        if (ids != null) {
            for (String id : ids) {
                result.add(UUID.fromString(id));
            }
        }
        return result;
    }

    /**
     * Takes a due entry for this instance. Removal is atomic, so with several
     * instances sweeping, exactly one of them acts on each deadline.
     */
    public boolean claim(String key, UUID roomId) {
        Long removed = redis.opsForZSet().remove(key, roomId.toString());
        return removed != null && removed > 0;
    }

    // ---- Presence ---------------------------------------------------------

    /**
     * Presence is a sorted set scored by last heartbeat, so a member who closes
     * a laptop lid ages out without ever sending a disconnect.
     */
    /**
     * Marks a member present.
     *
     * @return true when they were not present before (never seen, left, or
     *     aged out), which is the moment the room should hear they arrived
     */
    public boolean heartbeat(UUID roomId, UUID memberId) {
        String key = membersKey(roomId);
        long now = System.currentTimeMillis();
        Double previous = redis.opsForZSet().score(key, memberId.toString());
        redis.opsForZSet().add(key, memberId.toString(), now);
        redis.expire(key, stateTtl);
        // So the presence sweep knows to look at this room.
        redis.opsForSet().add(LIVE_ROOMS_KEY, roomId.toString());
        return previous == null || previous < now - heartbeatTtl.toMillis();
    }

    /** When this member's last heartbeat landed, or null when they are not present right now. */
    public Long lastHeartbeat(UUID roomId, UUID memberId) {
        Double score = redis.opsForZSet().score(membersKey(roomId), memberId.toString());
        if (score == null || score < System.currentTimeMillis() - heartbeatTtl.toMillis()) {
            return null;
        }
        return score.longValue();
    }

    /** Rooms with anyone in their presence set: what the presence sweep walks. */
    public Set<UUID> roomsWithPresence() {
        Set<String> ids = redis.opsForSet().members(LIVE_ROOMS_KEY);
        if (ids == null) {
            return Set.of();
        }
        return ids.stream().map(UUID::fromString).collect(Collectors.toSet());
    }

    /**
     * Stops sweeping a room once nobody is left in it. A heartbeat racing this
     * only drops the room from the sweep until that member's next heartbeat.
     */
    public void forgetIfEmpty(UUID roomId) {
        Long count = redis.opsForZSet().zCard(membersKey(roomId));
        if (count == null || count == 0) {
            redis.opsForSet().remove(LIVE_ROOMS_KEY, roomId.toString());
        }
    }

    /**
     * Records whether a member is keeping up.
     *
     * @return true when the status changed, which is the only time it is worth
     *     telling the room about
     */
    public boolean recordHealth(UUID roomId, UUID memberId, boolean behind) {
        String key = healthKey(roomId);
        String value = behind ? "1" : "0";
        Object previous = redis.opsForHash().get(key, memberId.toString());
        redis.opsForHash().put(key, memberId.toString(), value);
        redis.expire(key, stateTtl);
        return !value.equals(previous);
    }

    public void removePresence(UUID roomId, UUID memberId) {
        redis.opsForHash().delete(healthKey(roomId), memberId.toString());
        redis.opsForZSet().remove(membersKey(roomId), memberId.toString());
    }

    /**
     * Who is watching right now. Read-only: aged-out entries are filtered, not
     * pruned, so {@link #expirePresence} can still see them and announce that
     * they left.
     */
    public Set<UUID> presentMembers(UUID roomId) {
        String key = membersKey(roomId);
        long cutoff = System.currentTimeMillis() - heartbeatTtl.toMillis();
        Set<String> ids = redis.opsForZSet().rangeByScore(key, cutoff, Double.POSITIVE_INFINITY);
        if (ids == null) {
            return Set.of();
        }
        return ids.stream().map(UUID::fromString).collect(Collectors.toSet());
    }

    /**
     * Drops members whose heartbeats stopped without a disconnect (a laptop
     * lid, a dead network). Read and removal are one script, so when several
     * instances sweep the same room, each departure is claimed, and announced,
     * exactly once.
     *
     * @return the members dropped, so the room can be told they left
     */
    public Set<UUID> expirePresence(UUID roomId) {
        long cutoff = System.currentTimeMillis() - heartbeatTtl.toMillis();
        List<?> stale = redis.execute(expireScript, List.of(membersKey(roomId)), String.valueOf(cutoff));
        if (stale == null || stale.isEmpty()) {
            return Set.of();
        }
        List<String> ids = stale.stream().map(String::valueOf).toList();
        redis.opsForHash().delete(healthKey(roomId), ids.toArray());
        return ids.stream().map(UUID::fromString).collect(Collectors.toSet());
    }

    private static long asLong(Object value, long fallback) {
        if (value == null) {
            return fallback;
        }
        try {
            return Long.parseLong(String.valueOf(value));
        } catch (NumberFormatException ex) {
            return fallback;
        }
    }

    private static float asFloat(Object value) {
        if (value == null) {
            return 1.0f;
        }
        try {
            return Float.parseFloat(String.valueOf(value));
        } catch (NumberFormatException ex) {
            return 1.0f;
        }
    }
}
