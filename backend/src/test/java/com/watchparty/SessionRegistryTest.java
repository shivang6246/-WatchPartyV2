package com.watchparty;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.watchparty.security.SessionRegistry;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.WebSocketSession;

class SessionRegistryTest {

    private final SessionRegistry registry = new SessionRegistry();

    private WebSocketSession open(String id, UUID member) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(id);
        when(session.isOpen()).thenReturn(true);
        registry.register(session);
        registry.bind(id, member);
        return session;
    }

    @Test
    void closingOneOfTwoTabsIsNotLeaving() {
        UUID member = UUID.randomUUID();
        open("tab-1", member);
        open("tab-2", member);

        assertThat(registry.hasOtherSession(member, "tab-1")).isTrue();
    }

    @Test
    void closingTheLastTabIsLeaving() {
        UUID member = UUID.randomUUID();
        WebSocketSession only = open("tab-1", member);

        assertThat(registry.hasOtherSession(member, "tab-1")).isFalse();

        registry.unregister(only);
        assertThat(registry.hasOtherSession(member, "tab-1")).isFalse();
    }

    @Test
    void someoneElsesSessionDoesNotCount() {
        UUID member = UUID.randomUUID();
        open("tab-1", member);
        open("other", UUID.randomUUID());

        assertThat(registry.hasOtherSession(member, "tab-1")).isFalse();
    }

    @Test
    void aSocketAlreadyClosedDoesNotCount() {
        UUID member = UUID.randomUUID();
        open("tab-1", member);
        WebSocketSession dying = open("tab-2", member);
        when(dying.isOpen()).thenReturn(false);

        assertThat(registry.hasOtherSession(member, "tab-1")).isFalse();
    }
}
