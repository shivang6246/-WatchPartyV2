package com.watchparty.catalog;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.watchparty.catalog.CatalogDtos.CatalogItem;
import com.watchparty.room.Platform;
import com.watchparty.room.VideoSource;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * Turns a pasted link into something with a title and a thumbnail.
 *
 * <p>This path uses oEmbed, which needs no API key, so pasting a link keeps
 * working on a deployment that has not configured YouTube search at all.
 */
@Service
public class LinkResolver {

    private static final Logger log = LoggerFactory.getLogger(LinkResolver.class);

    private final ObjectMapper objectMapper;
    private final RestClient restClient = RestClient.create();

    public LinkResolver(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public CatalogItem resolve(Platform requested, String url) {
        VideoSource source = VideoSource.resolve(requested, url);
        return switch (source.platform()) {
            case YOUTUBE -> oembed(
                    source,
                    "https://www.youtube.com/oembed?format=json&url="
                            + encode("https://www.youtube.com/watch?v=" + source.ref()),
                    null);
            case VIMEO -> oembed(
                    source, "https://vimeo.com/api/oembed.json?url=" + encode(source.url()), "duration");
            default -> new CatalogItem(
                    source.platform().value(),
                    source.ref(),
                    source.url(),
                    fileNameOf(source.url()),
                    null,
                    null,
                    null,
                    false);
        };
    }

    private CatalogItem oembed(VideoSource source, String endpoint, String durationField) {
        String title = null;
        String author = null;
        String thumbnail = null;
        Long durationMs = null;
        try {
            // URI.create, not uri(String): RestClient treats a string as a URI
            // template and would percent-encode the already-encoded query.
            String body = restClient.get().uri(URI.create(endpoint)).retrieve().body(String.class);
            JsonNode node = objectMapper.readTree(body == null ? "{}" : body);
            title = node.path("title").asText(null);
            author = node.path("author_name").asText(null);
            thumbnail = node.path("thumbnail_url").asText(null);
            if (durationField != null && node.hasNonNull(durationField)) {
                durationMs = node.path(durationField).asLong() * 1000;
            }
        } catch (Exception ex) {
            // A private or removed video still gives a usable room; the title
            // just falls back to the id.
            log.debug("oEmbed lookup failed for {}: {}", source.url(), ex.toString());
        }
        if (thumbnail == null && source.platform() == Platform.YOUTUBE) {
            thumbnail = "https://i.ytimg.com/vi/" + source.ref() + "/hqdefault.jpg";
        }
        return new CatalogItem(
                source.platform().value(),
                source.ref(),
                source.url(),
                title == null || title.isBlank() ? source.ref() : title,
                author,
                thumbnail,
                durationMs,
                false);
    }

    private static String fileNameOf(String url) {
        if (url == null) {
            return "Video";
        }
        String path = url.split("\\?")[0];
        int slash = path.lastIndexOf('/');
        String name = slash >= 0 && slash < path.length() - 1 ? path.substring(slash + 1) : path;
        return name.isBlank() ? "Video" : name;
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
