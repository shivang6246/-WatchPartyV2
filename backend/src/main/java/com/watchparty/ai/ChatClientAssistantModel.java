package com.watchparty.ai;

import com.google.genai.errors.ApiException;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;

/**
 * The assistant on Spring AI's {@link ChatClient}. Which model answers is the
 * {@link ChatModel} it is given: Gemini in {@link AiConfig}, a stand-in in the
 * tests.
 */
public final class ChatClientAssistantModel implements AssistantModel {

    private static final int TOO_MANY_REQUESTS = 429;

    private final ChatClient client;

    public ChatClientAssistantModel(ChatModel model) {
        // The rules ride on every request as the system message; the room and
        // the question are the user message.
        this.client = ChatClient.builder(model).defaultSystem(AssistantPrompt.SYSTEM).build();
    }

    @Override
    public boolean configured() {
        return true;
    }

    @Override
    public Answer ask(String prompt) {
        ChatResponse response;
        try {
            // No template parameters are passed, so the text goes out as it is:
            // a brace typed in the chat is not read as a placeholder.
            response = client.prompt().user(prompt).call().chatResponse();
        } catch (RuntimeException ex) {
            throw new Unavailable("The model did not answer: " + rootMessage(ex), outOfQuota(ex), ex);
        }
        if (response == null) {
            return new Answer(null, 0, 0);
        }
        // No result at all is a blocked or empty candidate, not an error.
        String text = response.getResult() == null ? null : response.getResult().getOutput().getText();
        Usage usage = response.getMetadata().getUsage();
        return new Answer(text, count(usage.getPromptTokens()), count(usage.getCompletionTokens()));
    }

    private static long count(Integer tokens) {
        return tokens == null ? 0 : tokens;
    }

    /** Spring AI wraps the SDK's error, which is where the HTTP status lives. */
    private static boolean outOfQuota(Throwable ex) {
        for (Throwable cause = ex; cause != null; cause = cause.getCause()) {
            if (cause instanceof ApiException api) {
                return api.code() == TOO_MANY_REQUESTS;
            }
        }
        return false;
    }

    private static String rootMessage(Throwable ex) {
        Throwable root = ex;
        while (root.getCause() != null) {
            root = root.getCause();
        }
        return root.toString();
    }
}
