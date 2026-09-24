package com.watchparty;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.watchparty.common.ApiException;
import com.watchparty.room.Platform;
import com.watchparty.room.QueueItem;
import com.watchparty.room.RoomService;
import com.watchparty.room.VideoSource;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class QueueRulesTest {

    private static QueueItem item(String ref) {
        VideoSource source = new VideoSource(Platform.YOUTUBE, "https://youtu.be/" + ref, ref);
        return new QueueItem(source, ref, null, null, 60_000L, UUID.randomUUID(), "Host");
    }

    @Test
    void reorderingFollowsTheGivenOrder() {
        QueueItem a = item("aaaaaaaaaaa");
        QueueItem b = item("bbbbbbbbbbb");
        QueueItem c = item("ccccccccccc");

        List<QueueItem> result = RoomService.reordered(
                List.of(a, b, c), List.of(c.getItemId(), a.getItemId(), b.getItemId()));

        assertThat(result).containsExactly(c, a, b);
    }

    @Test
    void reorderingFromAStaleQueueIsRefusedRatherThanDroppingAVideo() {
        QueueItem a = item("aaaaaaaaaaa");
        QueueItem b = item("bbbbbbbbbbb");

        assertThatThrownBy(() -> RoomService.reordered(List.of(a, b), List.of(a.getItemId())))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> RoomService.reordered(List.of(a, b), List.of(a.getItemId(), UUID.randomUUID())))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> RoomService.reordered(List.of(a, b), List.of(a.getItemId(), a.getItemId())))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void youtubeItemsGetArtworkWithoutAnyoneResolvingIt() {
        assertThat(item("dQw4w9WgXcQ").getThumbnail()).isEqualTo("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    }

    @Test
    void anEndedReportIsBelievedOnlyNearTheEndOfTheProjection() {
        assertThat(RoomService.plausiblyEnded(118_000, 120_000L)).isTrue();
        assertThat(RoomService.plausiblyEnded(120_000, 120_000L)).isTrue();
        assertThat(RoomService.plausiblyEnded(60_000, 120_000L)).isFalse();
    }

    @Test
    void withoutAServerSideDurationNoEndedReportIsBelieved() {
        // Otherwise a member could skip a video by claiming it is short.
        assertThat(RoomService.plausiblyEnded(59_000, null)).isFalse();
        assertThat(RoomService.plausiblyEnded(0, 0L)).isFalse();
    }
}
