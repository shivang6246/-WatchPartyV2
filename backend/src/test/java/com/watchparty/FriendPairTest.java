package com.watchparty;

import static org.assertj.core.api.Assertions.assertThat;

import com.watchparty.friend.FriendService;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class FriendPairTest {

    @Test
    void eitherSideAskingFindsTheSamePair() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        assertThat(FriendService.pair(a, b)).containsExactly(FriendService.pair(b, a));
    }

    @Test
    void thePairIsInPostgresOrderNotJavasSignedOrder() {
        // Java's compareTo reads the high half as a signed long, so it puts
        // 8000... before 0000...; Postgres (and the table's user_low < user_high
        // check) orders them the other way.
        UUID high = UUID.fromString("80000000-0000-0000-0000-000000000000");
        UUID low = UUID.fromString("00000000-0000-0000-0000-000000000001");
        assertThat(high.compareTo(low)).isNegative();

        assertThat(FriendService.pair(high, low)).containsExactly(low, high);
        assertThat(FriendService.pair(low, high)).containsExactly(low, high);
    }
}
