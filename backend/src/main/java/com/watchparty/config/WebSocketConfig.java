package com.watchparty.config;

import com.watchparty.security.SessionRegistry;
import com.watchparty.security.StompAuthInterceptor;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;
import org.springframework.web.socket.server.HandshakeInterceptor;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    public static final String ATTR_CLIENT_IP = "clientIp";

    private final AppProperties props;
    private final StompAuthInterceptor stompAuthInterceptor;
    private final SessionRegistry sessionRegistry;

    public WebSocketConfig(
            AppProperties props, StompAuthInterceptor stompAuthInterceptor, SessionRegistry sessionRegistry) {
        this.props = props;
        this.stompAuthInterceptor = stompAuthInterceptor;
        this.sessionRegistry = sessionRegistry;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        List<String> origins = new ArrayList<>(props.cors().allowedOrigins());
        for (String id : props.cors().allowedExtensionIds()) {
            if (!id.isBlank()) {
                origins.add(id.startsWith("chrome-extension://") ? id : "chrome-extension://" + id);
            }
        }
        registry.addEndpoint("/ws")
                .setAllowedOrigins(origins.toArray(String[]::new))
                .addInterceptors(clientIpInterceptor());
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("ws-heartbeat-");
        scheduler.initialize();

        // Stage 2 keeps the simple broker and fans out across instances through
        // Redis; stage 3 replaces this line with setStompBrokerRelay(...).
        registry.enableSimpleBroker("/topic", "/queue")
                .setHeartbeatValue(new long[] {10000, 10000})
                .setTaskScheduler(scheduler);
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(stompAuthInterceptor);
    }

    /**
     * Tracks raw sessions so a removed member's socket can be closed by the
     * server, not merely have its frames rejected. See {@link SessionRegistry}.
     */
    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        registration.addDecoratorFactory(handler -> new WebSocketHandlerDecorator(handler) {
            @Override
            public void afterConnectionEstablished(WebSocketSession session) throws Exception {
                sessionRegistry.register(session);
                super.afterConnectionEstablished(session);
            }

            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus closeStatus) throws Exception {
                sessionRegistry.unregister(session);
                super.afterConnectionClosed(session, closeStatus);
            }
        });
    }

    /** Carries the handshake's client address forward for the connect rate limit. */
    private HandshakeInterceptor clientIpInterceptor() {
        return new HandshakeInterceptor() {
            @Override
            public boolean beforeHandshake(
                    ServerHttpRequest request,
                    ServerHttpResponse response,
                    WebSocketHandler handler,
                    Map<String, Object> attributes) {
                if (request instanceof ServletServerHttpRequest servletRequest) {
                    attributes.put(ATTR_CLIENT_IP, servletRequest.getServletRequest().getRemoteAddr());
                }
                return true;
            }

            @Override
            public void afterHandshake(
                    ServerHttpRequest request,
                    ServerHttpResponse response,
                    WebSocketHandler handler,
                    Exception exception) {
                // nothing to do
            }
        };
    }
}
