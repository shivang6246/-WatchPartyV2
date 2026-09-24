package com.watchparty;

import static org.assertj.core.api.Assertions.assertThat;

import com.watchparty.sync.RoomState;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class RoomStateTest {

    private static RoomState state(long positionMs, boolean playing, float speed, long anchor, Long duration) {
        return new RoomState(UUID.randomUUID(), positionMs, playing, speed, anchor, duration, false, 1);
    }

    @Test
    void pausedRoomsProjectToTheStoredPosition() {
        RoomState paused = state(60_000, false, 1.0f, 1_000_000, null);
        assertThat(paused.projectedPositionMs(1_500_000)).isEqualTo(60_000);
    }

    @Test
    void playingRoomsAdvanceWithTheServerClock() {
        RoomState playing = state(60_000, true, 1.0f, 1_000_000, null);
        assertThat(playing.projectedPositionMs(1_010_000)).isEqualTo(70_000);
    }

    @Test
    void playbackSpeedScalesTheProjection() {
        RoomState fast = state(0, true, 2.0f, 1_000_000, null);
        assertThat(fast.projectedPositionMs(1_010_000)).isEqualTo(20_000);
    }

    @Test
    void projectionNeverRunsPastTheMediaDuration() {
        RoomState nearEnd = state(90_000, true, 1.0f, 1_000_000, 100_000L);
        assertThat(nearEnd.projectedPositionMs(1_060_000)).isEqualTo(100_000);
    }
}
