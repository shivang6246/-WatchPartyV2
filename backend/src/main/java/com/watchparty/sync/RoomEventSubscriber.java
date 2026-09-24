package com.watchparty.sync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.stereotype.Component;

/** Delivers fanned-out room events to the STOMP sessions held by this instance. */
@Component
public class RoomEventSubscriber implements MessageListener {

    private static final Logger log = LoggerFactory.getLogger(RoomEventSubscriber.class);

    private final ObjectMapper objectMapper;
    private final RoomEventPublisher publisher;

    public RoomEventSubscriber(ObjectMapper objectMapper, @Lazy RoomEventPublisher publisher) {
        this.objectMapper = objectMapper;
        this.publisher = publisher;
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            String raw = new String(message.getBody(), StandardCharsets.UTF_8);
            RoomEventPublisher.Envelope envelope =
                    objectMapper.readValue(raw, RoomEventPublisher.Envelope.class);
            JsonNode payload = objectMapper.readTree(envelope.payload());
            publisher.deliverLocally(envelope.target(), payload);
        } catch (Exception ex) {
            log.error("Failed to deliver fanned-out room event", ex);
        }
    }
}
