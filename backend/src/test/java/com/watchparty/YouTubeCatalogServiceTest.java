package com.watchparty;

import static org.assertj.core.api.Assertions.assertThat;

import com.watchparty.catalog.YouTubeCatalogService;
import org.junit.jupiter.api.Test;

class YouTubeCatalogServiceTest {

    @Test
    void parsesTheIso8601DurationsYouTubeReturns() {
        assertThat(YouTubeCatalogService.parseIso8601("PT3M33S")).isEqualTo(213_000L);
        assertThat(YouTubeCatalogService.parseIso8601("PT1H2M3S")).isEqualTo(3_723_000L);
        assertThat(YouTubeCatalogService.parseIso8601("PT45S")).isEqualTo(45_000L);
    }

    @Test
    void unparseableDurationsAreAbsentRatherThanZero() {
        // A live stream has no duration; zero would make the engine clamp every
        // seek to the start.
        assertThat(YouTubeCatalogService.parseIso8601(null)).isNull();
        assertThat(YouTubeCatalogService.parseIso8601("")).isNull();
        assertThat(YouTubeCatalogService.parseIso8601("not-a-duration")).isNull();
    }
}
