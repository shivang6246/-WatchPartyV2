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
import java.util.ArrayList;
import java.util.List;
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
        String region = (regionCode == null || regionCode.isBlank()) ? "US" : regionCode.toUpperCase();
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
        try {
            redis.opsForValue().set(key, objectMapper.writeValueAsString(page), CACHE_TTL);
        } catch (Exception ex) {
            log.debug("Could not cache catalogue page {}", key);
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
