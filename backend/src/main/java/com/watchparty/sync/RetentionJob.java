package com.watchparty.sync;

import com.watchparty.auth.EmailVerificationRepository;
import com.watchparty.auth.PendingRegistrationRepository;
import com.watchparty.auth.RefreshTokenRepository;
import com.watchparty.config.AppProperties;
import com.watchparty.room.ChatMessageRepository;
import com.watchparty.room.PlaybackEventRepository;
import com.watchparty.room.Room;
import com.watchparty.room.RoomRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Chat and playback events are deleted 30 days after a room closes; closed
 * rooms keep only their aggregate counts. Expired refresh tokens go too:
 * Postgres has no TTL index to do it on its own.
 */
@Component
public class RetentionJob {

    private static final Logger log = LoggerFactory.getLogger(RetentionJob.class);

    private final RoomRepository rooms;
    private final ChatMessageRepository chats;
    private final PlaybackEventRepository playbackEvents;
    private final RefreshTokenRepository refreshTokens;
    private final EmailVerificationRepository verifications;
    private final PendingRegistrationRepository signups;
    private final int retentionDays;

    public RetentionJob(
            RoomRepository rooms,
            ChatMessageRepository chats,
            PlaybackEventRepository playbackEvents,
            RefreshTokenRepository refreshTokens,
            EmailVerificationRepository verifications,
            PendingRegistrationRepository signups,
            AppProperties props) {
        this.rooms = rooms;
        this.chats = chats;
        this.playbackEvents = playbackEvents;
        this.refreshTokens = refreshTokens;
        this.verifications = verifications;
        this.signups = signups;
        this.retentionDays = props.room().retentionDays();
    }

    @Scheduled(cron = "0 30 3 * * *")
    public void purge() {
        Instant cutoff = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
        List<Room> due = rooms.findByActiveFalseAndClosedAtBefore(cutoff);
        for (Room room : due) {
            chats.deleteByRoomId(room.getId());
            playbackEvents.deleteByRoomId(room.getId());
        }
        if (!due.isEmpty()) {
            log.info("Purged chat and playback history for {} closed rooms", due.size());
        }
        // A day's grace past expiry keeps a just-expired token around long
        // enough for reuse detection to still recognise it.
        int tokens = refreshTokens.deleteExpiredBefore(Instant.now().minus(1, ChronoUnit.DAYS));
        if (tokens > 0) {
            log.info("Deleted {} expired refresh tokens", tokens);
        }
        int links = verifications.deleteExpiredBefore(Instant.now().minus(1, ChronoUnit.DAYS));
        if (links > 0) {
            log.info("Deleted {} expired verification links", links);
        }
        int abandoned = signups.deleteExpiredOrUsedBefore(Instant.now());
        if (abandoned > 0) {
            log.info("Deleted {} finished or abandoned sign-ups", abandoned);
        }
    }
}
