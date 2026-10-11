package com.watchparty;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.google.genai.errors.ClientException;
import com.watchparty.ai.AssistantModel;
import com.watchparty.ai.AssistantPrompt;
import com.watchparty.ai.ChatClientAssistantModel;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.chat.metadata.ChatResponseMetadata;
import org.springframework.ai.chat.metadata.DefaultUsage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;

/** The Spring AI side of the assistant, against a stand-in for Gemini. */
class ChatClientAssistantModelTest {

    private static ChatModel model(Function<Prompt, ChatResponse> answer) {
        return answer::apply;
    }

    private static ChatResponse reply(String text) {
        return new ChatResponse(
                List.of(new Generation(new AssistantMessage(text))),
                ChatResponseMetadata.builder().usage(new DefaultUsage(120, 18)).build());
    }

    @Test
    void theRulesGoAsTheSystemMessageAndTheRoomAsTheUserMessage() {
        AtomicReference<Prompt> sent = new AtomicReference<>();
        AssistantModel assistant = new ChatClientAssistantModel(model(prompt -> {
            sent.set(prompt);
            return reply("Denis Villeneuve.");
        }));

        AssistantModel.Answer answer = assistant.ask("QUESTION from Sam\nwho directed this?");

        assertThat(answer.text()).isEqualTo("Denis Villeneuve.");
        assertThat(answer.promptTokens()).isEqualTo(120);
        assertThat(answer.completionTokens()).isEqualTo(18);
        assertThat(sent.get().getInstructions()).extracting(message -> message.getMessageType())
                .containsExactly(MessageType.SYSTEM, MessageType.USER);
        assertThat(sent.get().getSystemMessage().getText()).isEqualTo(AssistantPrompt.SYSTEM);
        assertThat(sent.get().getUserMessage().getText()).isEqualTo("QUESTION from Sam\nwho directed this?");
    }

    @Test
    void bracesInTheChatAreTextNotTemplatePlaceholders() {
        AtomicReference<Prompt> sent = new AtomicReference<>();
        AssistantModel assistant = new ChatClientAssistantModel(model(prompt -> {
            sent.set(prompt);
            return reply("ok");
        }));
        String chat = "Alex: {name} and <tag> and {{ }} and $x\nQUESTION from Sam\nwhat is {this}?";

        assistant.ask(chat);

        assertThat(sent.get().getUserMessage().getText()).isEqualTo(chat);
    }

    @Test
    void noCandidateIsAnEmptyAnswerNotAFailure() {
        AssistantModel assistant = new ChatClientAssistantModel(
                model(prompt -> new ChatResponse(List.of(), ChatResponseMetadata.builder().build())));

        assertThat(assistant.ask("hi").text()).isNull();
    }

    @Test
    void aSpentQuotaIsToldApartFromAnyOtherFailure() {
        // Spring AI wraps the SDK's error the same way: the status is on the cause.
        AssistantModel spent = new ChatClientAssistantModel(model(prompt -> {
            throw new RuntimeException(
                    "Failed to generate content", new ClientException(429, "RESOURCE_EXHAUSTED", "Quota exceeded"));
        }));
        AssistantModel broken = new ChatClientAssistantModel(model(prompt -> {
            throw new RuntimeException(
                    "Failed to generate content", new ClientException(400, "INVALID_ARGUMENT", "API key not valid"));
        }));

        assertThatThrownBy(() -> spent.ask("hi"))
                .isInstanceOfSatisfying(AssistantModel.Unavailable.class, ex -> assertThat(ex.outOfQuota()).isTrue());
        assertThatThrownBy(() -> broken.ask("hi"))
                .isInstanceOfSatisfying(AssistantModel.Unavailable.class, ex -> assertThat(ex.outOfQuota()).isFalse())
                .hasMessageContaining("API key not valid");
    }
}
