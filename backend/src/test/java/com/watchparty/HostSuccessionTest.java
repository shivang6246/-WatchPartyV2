package com.watchparty;

import static org.assertj.core.api.Assertions.assertThat;

import com.watchparty.room.MemberRole;
import com.watchparty.room.RoomMember;
import com.watchparty.sync.RoomWatchdog;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class HostSuccessionTest {

    private final UUID roomId = UUID.randomUUID();

    private RoomMember user(String name, MemberRole role) {
        return RoomMember.forUser(roomId, UUID.randomUUID(), name, role);
    }

    private RoomMember guest(String name) {
        return RoomMember.forGuest(roomId, UUID.randomUUID(), name);
    }

    @Test
    void theLongestStandingRegisteredMemberWhoIsWatchingTakesOver() {
        RoomMember host = user("Host", MemberRole.HOST);
        RoomMember first = user("First", MemberRole.MEMBER);
        RoomMember second = user("Second", MemberRole.MEMBER);

        var picked = RoomWatchdog.pickSuccessor(
                List.of(host, first, second), Set.of(first.getId(), second.getId()));

        assertThat(picked).contains(first);
    }

    @Test
    void guestsAreSkippedBecauseHostingNeedsAnAccount() {
        RoomMember host = user("Host", MemberRole.HOST);
        RoomMember earlyGuest = guest("Early guest");
        RoomMember later = user("Later", MemberRole.MEMBER);

        var picked = RoomWatchdog.pickSuccessor(
                List.of(host, earlyGuest, later), Set.of(earlyGuest.getId(), later.getId()));

        assertThat(picked).contains(later);
    }

    @Test
    void membersWhoAreNotWatchingOrWereRemovedAreSkipped() {
        RoomMember host = user("Host", MemberRole.HOST);
        RoomMember away = user("Away", MemberRole.MEMBER);
        RoomMember removed = user("Removed", MemberRole.MEMBER);
        removed.setRemoved(true);
        RoomMember watching = user("Watching", MemberRole.MEMBER);

        var picked = RoomWatchdog.pickSuccessor(
                List.of(host, away, removed, watching), Set.of(removed.getId(), watching.getId()));

        assertThat(picked).contains(watching);
    }

    @Test
    void aRoomOfGuestsHasNoSuccessor() {
        RoomMember host = user("Host", MemberRole.HOST);
        RoomMember guest = guest("Guest");

        assertThat(RoomWatchdog.pickSuccessor(List.of(host, guest), Set.of(guest.getId()))).isEmpty();
    }
}
