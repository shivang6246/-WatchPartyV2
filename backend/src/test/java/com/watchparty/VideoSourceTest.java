package com.watchparty;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.watchparty.common.ApiException;
import com.watchparty.room.Platform;
import com.watchparty.room.VideoSource;
import org.junit.jupiter.api.Test;

class VideoSourceTest {

    @Test
    void extractsYouTubeIdFromEveryCommonUrlShape() {
        assertThat(VideoSource.resolve(Platform.YOUTUBE, "https://www.youtube.com/watch?v=dQw4w9WgXcQ").ref())
                .isEqualTo("dQw4w9WgXcQ");
        assertThat(VideoSource.resolve(Platform.YOUTUBE, "https://youtu.be/dQw4w9WgXcQ?t=30").ref())
                .isEqualTo("dQw4w9WgXcQ");
        assertThat(VideoSource.resolve(Platform.YOUTUBE, "https://www.youtube.com/shorts/dQw4w9WgXcQ").ref())
                .isEqualTo("dQw4w9WgXcQ");
        assertThat(VideoSource.resolve(
                        Platform.YOUTUBE, "https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ").ref())
                .isEqualTo("dQw4w9WgXcQ");
    }

    @Test
    void rejectsNonHttpSchemes() {
        assertThatThrownBy(() -> VideoSource.resolve(Platform.HOSTED, "javascript:alert(1)"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("http");
    }

    @Test
    void hostedSourceMustLookPlayable() {
        assertThat(VideoSource.resolve(Platform.HOSTED, "https://cdn.example.com/a/movie.mp4").platform())
                .isEqualTo(Platform.HOSTED);
        assertThat(VideoSource.resolve(Platform.HOSTED, "https://cdn.example.com/live/index.m3u8").platform())
                .isEqualTo(Platform.HOSTED);
        assertThatThrownBy(() -> VideoSource.resolve(Platform.HOSTED, "https://example.com/page"))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void drmRoomsNeedNoPlayableUrl() {
        VideoSource source = VideoSource.resolve(Platform.DRM_EXTENSION, null);
        assertThat(source.platform().playableOnWeb()).isFalse();
    }
}
