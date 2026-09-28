package com.watchparty;

import static org.assertj.core.api.Assertions.assertThat;

import com.watchparty.catalog.CatalogDtos.CatalogItem;
import com.watchparty.catalog.YouTubeCatalogService;
import java.util.List;
import org.junit.jupiter.api.Test;

class YouTubeCatalogServiceTest {

    @Test
    void parsesTheIso8601DurationsYouTubeReturns() {
        assertThat(YouTubeCatalogService.parseIso8601("PT3M33S")).isEqualTo(213_000L);
        assertThat(YouTubeCatalogService.parseIso8601("PT1H2M3S")).isEqualTo(3_723_000L);
        assertThat(YouTubeCatalogService.parseIso8601("PT45S")).isEqualTo(45_000L);
    }

    @Test
    void regionsAreRealCountryCodesOrTheDefault() {
        assertThat(YouTubeCatalogService.normalizeRegion("in")).isEqualTo("IN");
        assertThat(YouTubeCatalogService.normalizeRegion(" gb ")).isEqualTo("GB");
        // Anything else would become a new cache key, and a new quota-costing call.
        assertThat(YouTubeCatalogService.normalizeRegion("ZZ")).isEqualTo("US");
        assertThat(YouTubeCatalogService.normalizeRegion("../../x")).isEqualTo("US");
        assertThat(YouTubeCatalogService.normalizeRegion(null)).isEqualTo("US");
    }

    @Test
    void theBackdropGetsTrailersNotShortsClipsOrStreams() {
        List<CatalogItem> found = List.of(
                item("a", "Dune: Part Three | Official Trailer", 150_000L),
                item("b", "Official Trailer #shorts", 50_000L),
                item("c", "Official Trailer (the first 20 seconds)", 20_000L),
                live("d", "Official Trailer premiere"),
                item("e", "Teaser: Something New", 70_000L),
                item("f", "Final Trailer", 140_000L),
                item("g", "Cast interview", 300_000L));

        assertThat(YouTubeCatalogService.pickTrailers(found))
                .extracting(CatalogItem::ref)
                .containsExactly("a", "e", "f");
    }

    @Test
    void withTooFewTitledTrailersEverythingWatchableStays() {
        List<CatalogItem> found = List.of(item("a", "Official Trailer", 120_000L), item("b", "Cast interview", 300_000L));
        assertThat(YouTubeCatalogService.pickTrailers(found)).extracting(CatalogItem::ref).containsExactly("a", "b");
    }

    @Test
    void aTrailerIsAWordNotAFragment() {
        // A word that merely contains it, like "Trailerpark", is not a trailer.
        List<CatalogItem> found = List.of(
                item("a", "Trailerpark Boys", 90_000L),
                item("b", "Official Trailer", 90_000L),
                item("c", "Teaser", 90_000L),
                item("d", "Trailer 2", 90_000L));
        assertThat(YouTubeCatalogService.pickTrailers(found)).extracting(CatalogItem::ref).containsExactly("b", "c", "d");
    }

    private static CatalogItem item(String ref, String title, long durationMs) {
        return new CatalogItem("youtube", ref, "https://www.youtube.com/watch?v=" + ref, title, "", null, durationMs, false);
    }

    private static CatalogItem live(String ref, String title) {
        return new CatalogItem("youtube", ref, "https://www.youtube.com/watch?v=" + ref, title, "", null, null, true);
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
