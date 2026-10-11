package com.watchparty.ai;

import com.google.genai.Client;
import com.google.genai.types.HttpOptions;
import com.google.genai.types.HttpRetryOptions;
import com.watchparty.config.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.google.genai.GoogleGenAiChatModel;
import org.springframework.ai.google.genai.GoogleGenAiChatOptions;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.retry.support.RetryTemplate;

@Configuration
public class AiConfig {

    private static final Logger log = LoggerFactory.getLogger(AiConfig.class);

    /** A chat reply that has not come by now is not worth waiting for. */
    private static final int TIMEOUT_MS = 20_000;

    /**
     * Gemini counts the model's own thinking against this as well as the
     * reply, so it is sized well past the few sentences asked for: a cap that
     * only fits the reply can leave nothing for it. The reply itself is cut to
     * a chat message afterwards.
     */
    private static final int MAX_OUTPUT_TOKENS = 1024;

    /**
     * Gemini where a key is configured, nothing where it is not.
     *
     * <p>Built by hand rather than by Spring AI's starter: its
     * auto-configuration treats a missing key as "use Vertex AI" and fails
     * startup asking for a Google Cloud project. Here a missing key is an
     * ordinary state (the assistant is off), and as with mail the choice is
     * made on the value being non-blank: {@code ${GEMINI_API_KEY:}} leaves an
     * empty string behind.
     */
    @Bean
    public AssistantModel assistantModel(AppProperties props) {
        AppProperties.Ai ai = props.ai();
        if (!ai.configured()) {
            log.info("No Gemini API key configured: the room assistant is off.");
            return new Off();
        }

        // An API key means the Gemini Developer API (AI Studio), which is the
        // one with a free tier. Said outright, so a GOOGLE_GENAI_USE_VERTEXAI
        // in the environment cannot point the same key at Vertex.
        Client client = Client.builder()
                .apiKey(ai.apiKey().strip())
                .vertexAI(false)
                .httpOptions(HttpOptions.builder()
                        .timeout(TIMEOUT_MS)
                        .retryOptions(HttpRetryOptions.builder().attempts(1))
                        .build())
                .build();
        GoogleGenAiChatModel model = GoogleGenAiChatModel.builder()
                .genAiClient(client)
                .defaultOptions(GoogleGenAiChatOptions.builder()
                        .model(ai.model())
                        .temperature(0.7)
                        .maxOutputTokens(MAX_OUTPUT_TOKENS)
                        .build())
                // One attempt, here and in the client above. The usual failure
                // is a spent free quota, which a retry cannot fix, and the
                // person who asked can simply ask again.
                .retryTemplate(RetryTemplate.builder().maxAttempts(1).build())
                .build();
        log.info("Room assistant answering with {}", ai.model());
        return new ChatClientAssistantModel(model);
    }

    private static final class Off implements AssistantModel {
        @Override
        public boolean configured() {
            return false;
        }

        @Override
        public Answer ask(String prompt) {
            throw new Unavailable("No model is configured.", false, null);
        }
    }
}
