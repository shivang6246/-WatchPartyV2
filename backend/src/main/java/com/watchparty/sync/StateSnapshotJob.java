package com.watchparty.sync;

import com.watchparty.metrics.WatchPartyMetrics;
import com.watchparty.room.Room;
import com.watchparty.room.RoomRepository;
import com.watchparty.room.RoomService;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Writes live Redis state back into Postgres, and retires rooms nobody came
 * back to.
 */
@Component
public class StateSnapshotJob {

    private static final Logger log = LoggerFactory.getLogger(StateSnapshotJob.class);

    private final RoomRepository rooms;
    private final RoomService roomService;
    private final RoomWatchdog watchdog;
    private final WatchPartyMetrics metrics;

    public StateSnapshotJob(
            RoomRepository rooms, RoomService roomService, RoomWatchdog watchdog, WatchPartyMetrics metrics) {
        this.rooms = rooms;
        this.roomService = roomService;
        this.watchdog = watchdog;
        this.metrics = metrics;
    }

    @Scheduled(fixedDelayString = "${app.room.snapshot-interval-ms}")
    public void snapshotActiveRooms() {
        int written = 0;
        List<Room> active = rooms.findByActiveTrue();
        metrics.setActiveRooms(active.size());
        for (Room room : active) {
            try {
                roomService.snapshot(room);
                written++;
                // Presence that aged out without a disconnect event is only
                // noticed here.
                watchdog.audit(room);
            } catch (RuntimeException ex) {
                log.warn("Snapshot failed for room {}", room.getId(), ex);
            }
        }
        if (written > 0) {
            log.debug("Snapshotted {} active rooms", written);
        }
    }

    /** Abandoned rooms release their code back into circulation. */
    @Scheduled(cron = "0 */5 * * * *")
    public void expireRooms() {
        List<Room> expired = rooms.findByActiveTrueAndExpiresAtBefore(Instant.now());
        for (Room room : expired) {
            try {
                roomService.closeRoom(room, "expired");
            } catch (RuntimeException ex) {
                log.warn("Expiring room {} failed", room.getId(), ex);
            }
        }
    }
}
