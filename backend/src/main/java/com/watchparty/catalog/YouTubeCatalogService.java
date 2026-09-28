package com.watchparty.catalog;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.watchparty.catalog.CatalogDtos.CatalogItem;
import com.watchparty.catalog.CatalogDtos.CatalogPage;
import com.watchparty.common.ApiException;
import com.watchparty.config.AppProperties;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * Browsing YouTube from inside the app.
 *
 * <p>A page cannot iframe youtube.com, which refuses to be framed, so "opening
 * YouTube in the app" means rendering the results ourselves and embedding only
 * the player, which the IFrame API does allow. Search therefore runs
 * server-side, which also keeps the API key out of the browser.
 *
 * <p>Results are cached in Redis: one search costs 100 quota units against a
 * default daily allowance of 10,000, so an uncached search box would burn a
 * project's quota in about a hundred keystrokes.
 */
@Service
public class YouTubeCatalogService {

    private static final Logger log = LoggerFactory.getLogger(YouTubeCatalogService.class);
    private static final String API = "https://www.googleapis.com/youtube/v3";
    private static final Duration CACHE_TTL = Duration.ofMinutes(10);
    private static final String DEFAULT_REGION = "US";
    /** Every region YouTube could chart. Anything else falls back to the default, never into a cache key. */
    private static final Set<String> REGIONS = Set.of(Locale.getISOCountries());
    private static final Pattern TRAILER = Pattern.compile("\\b(trailer|teaser)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern SHORTS = Pattern.compile("#shorts?\\b", Pattern.CASE_INSENSITIVE);
    /** Shorter than this is a clip or a Short, not a trailer. */
    private static final long MIN_TRAILER_MS = 45_000;
    /** How far back "new trailers" reach. */
    private static final Duration TRAILER_WINDOW = Duration.ofDays(30);
    /**
     * The trailer feed is one search (100 units) plus one lookup (1 unit), so
     * it is kept for hours, not minutes: about 400 units a day, whoever asks.
     */
    private static final Duration TRAILERS_TTL = Duration.ofHours(6);

    private final AppProperties props;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final RestClient restClient = RestClient.create();

    public YouTubeCatalogService(AppProperties props, StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.props = props;
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    public boolean searchAvailable() {
        return props.youtube().apiKey() != null && !props.youtube().apiKey().isBlank();
    }

    public CatalogPage search(String query, String pageToken) {
        if (!searchAvailable()) {
            // Not an error: the client falls back to pasting a link, which needs
            // no key at all.
            return new CatalogPage(List.of(), null, "search_unavailable");
        }
        String cacheKey = "catalog:yt:search:" + query.toLowerCase() + ":" + (pageToken == null ? "" : pageToken);
        CatalogPage cached = readCache(cacheKey);
        if (cached != null) {
            return cached;
        }

        JsonNode response = call("/search?part=snippet&type=video&maxResults=24&safeSearch=moderate"
                + "&videoEmbeddable=true&q=" + encode(query)
                + (pageToken == null || pageToken.isBlank() ? "" : "&pageToken=" + encode(pageToken)));

        List<String> ids = StreamSupport.stream(response.path("items").spliterator(), false)
                .map(item -> item.path("id").path("videoId").asText(null))
                .filter(id -> id != null && !id.isBlank())
                .collect(Collectors.toList());

        CatalogPage page = new CatalogPage(details(ids), response.path("nextPageToken").asText(null), null);
        writeCache(cacheKey, page);
        return page;
    }

    /** The default browse view, so the picker is never an empty search box. */
    public CatalogPage trending(String regionCode) {
        if (!searchAvailable()) {
            return new CatalogPage(List.of(), null, "search_unavailable");
        }
        String region = normalizeRegion(regionCode);
        String cacheKey = "catalog:yt:trending:" + region;
        CatalogPage cached = readCache(cacheKey);
        if (cached != null) {
            return cached;
        }

        JsonNode response = call(
                "/videos?part=snippet,contentDetails&chart=mostPopular&maxResults=24&regionCode=" + encode(region));
        CatalogPage page = new CatalogPage(toItems(response), null, null);
        writeCache(cacheKey, page);
        return page;
    }

    /**
     * New film trailers for the home screen's backdrop: the most-viewed
     * embeddable "official trailer" videos of the last thirty days, with
     * Shorts, clips and live streams left out. (The popular chart of the Film &
     * Animation category would cost 1 unit instead of 100, but it is Shorts
     * and memes, not trailers.)
     *
     * <p>Public, unlike the rest of the catalogue, so a signed-out visitor's
     * home screen has it too. That is affordable only because it is a single
     * cache key held for hours: no caller can make it search more often.
     */
    public CatalogPage trailers() {
        if (!searchAvailable()) {
            return new CatalogPage(List.of(), null, "search_unavailable");
        }
        String cacheKey = "catalog:yt:trailers";
        CatalogPage cached = readCache(cacheKey);
        if (cached != null) {
            return cached;
        }

        String since = Instant.now().minus(TRAILER_WINDOW).truncatedTo(ChronoUnit.SECONDS).toString();
        JsonNode response = call("/search?part=snippet&type=video&maxResults=50&order=viewCount&safeSearch=moderate"
                + "&videoEmbeddable=true&videoDuration=short&q=" + encode("official trailer")
                + "&publishedAfter=" + encode(since));
        List<String> ids = StreamSupport.stream(response.path("items").spliterator(), false)
                .map(item -> item.path("id").path("videoId").asText(null))
                .filter(id -> id != null && !id.isBlank())
                .collect(Collectors.toList());

        CatalogPage page = new CatalogPage(pickTrailers(details(ids)), null, null);
        writeCache(cacheKey, page, TRAILERS_TTL);
        return page;
    }

    /** A two-letter region YouTube knows, upper-cased, or the default for anything else. */
    public static String normalizeRegion(String regionCode) {
        if (regionCode == null) {
            return DEFAULT_REGION;
        }
        String region = regionCode.trim().toUpperCase(Locale.ROOT);
        return REGIONS.contains(region) ? region : DEFAULT_REGION;
    }

    /**
     * What a backdrop can loop: long enough to be a trailer rather than a
     * clip, not a Short, not live (a stream never ends). Of those, the ones
     * titled as trailers or teasers when there are a few; otherwise all.
     */
    public static List<CatalogItem> pickTrailers(List<CatalogItem> items) {
        List<CatalogItem> watchable = items.stream()
                .filter(item -> !item.live())
                .filter(item -> item.durationMs() != null && item.durationMs() >= MIN_TRAILER_MS)
                .filter(item -> !SHORTS.matcher(item.title()).find())
                .toList();
        List<CatalogItem> trailers = watchable.stream()
                .filter(item -> TRAILER.matcher(item.title()).find())
                .toList();
        return trailers.size() >= 3 ? trailers : watchable;
    }

    /** Hydrates ids with the duration and channel the search endpoint omits. */
    private List<CatalogItem> details(List<String> videoIds) {
        if (videoIds.isEmpty()) {
            return List.of();
        }
        JsonNode response = call("/videos?part=snippet,contentDetails&id=" + encode(String.join(",", videoIds)));
        return toItems(response);
    }

    private List<CatalogItem> toItems(JsonNode response) {
        List<CatalogItem> items = new ArrayList<>();
        for (JsonNode node : response.path("items")) {
            String id = node.path("id").asText(null);
            if (id == null) {
                continue;
            }
            JsonNode snippet = node.path("snippet");
            String duration = node.path("contentDetails").path("duration").asText(null);
            boolean live = "live".equals(snippet.path("liveBroadcastContent").asText(""));
            items.add(new CatalogItem(
                    "youtube",
                    id,
                    "https://www.youtube.com/watch?v=" + id,
                    snippet.path("title").asText(""),
                    snippet.path("channelTitle").asText(""),
                    thumbnail(snippet, id),
                    live ? null : parseIso8601(duration),
                    live));
        }
        return items;
    }

    private static String thumbnail(JsonNode snippet, String videoId) {
        JsonNode thumbnails = snippet.path("thumbnails");
        for (String size : List.of("medium", "high", "default")) {
            String url = thumbnails.path(size).path("url").asText(null);
            if (url != null && !url.isBlank()) {
                return url;
            }
        }
        return "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";
    }

    /** ISO-8601 durations, as YouTube returns them (PT1H2M3S). */
    public static Long parseIso8601(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Duration.parse(value).toMillis();
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private JsonNode call(String path) {
        try {
            // URI.create, not uri(String): RestClient treats a string as a URI
            // template and would percent-encode the already-encoded query.
            String body = restClient
                    .get()
                    .uri(URI.create(API + path + "&key=" + encode(props.youtube().apiKey())))
                    .retrieve()
                    .body(String.class);
            return objectMapper.readTree(body == null ? "{}" : body);
        } catch (Exception ex) {
            log.warn("YouTube catalogue call failed: {}", ex.toString());
            throw new ApiException(
                    HttpStatus.BAD_GATEWAY, "catalog_unavailable", "YouTube search is not responding right now.");
        }
    }

    private CatalogPage readCache(String key) {
        try {
            String cached = redis.opsForValue().get(key);
            return cached == null ? null : objectMapper.readValue(cached, CatalogPage.class);
        } catch (Exception ex) {
            return null;
        }
    }

    private void writeCache(String key, CatalogPage page) {
        writeCache(key, page, CACHE_TTL);
    }

    private void writeCache(String key, CatalogPage page, Duration ttl) {
        try {
            redis.opsForValue().set(key, objectMapper.writeValueAsString(page), ttl);
        } catch (Exception ex) {
            log.debug("Could not cache catalogue page {}", key);
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
