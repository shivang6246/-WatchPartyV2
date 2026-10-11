package com.watchparty.ai;

import com.watchparty.ai.AssistantPrompt.Line;
import com.watchparty.ai.AssistantPrompt.Scene;
import com.watchparty.config.AppProperties;
import com.watchparty.metrics.WatchPartyMetrics;
import com.watchparty.ratelimit.RateLimits;
import com.watchparty.ratelimit.RedisRateLimiter;
import com.watchparty.room.ChatMessage;
import com.watchparty.room.ChatMessageRepository;
import com.watchparty.room.QueueItem;
import com.watchparty.room.Room;
import com.watchparty.room.RoomDtos.ChatMessageView;
import com.watchparty.room.RoomMember;
import com.watchparty.sync.RoomEventPublisher;
import com.watchparty.sync.RoomState;
import com.watchparty.sync.RoomStateService;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

/**
 * The assistant in a room's chat. A member writes "@ai" and a question; the
 * question is an ordinary chat message everyone sees, and the answer comes
 * back as one too.
 *
 * <p>The answer is a stored {@link ChatMessage} under a fixed author id, sent
 * on the room's chat topic like any other. That topic carries one shape and
 * the Chrome extension renders it, so the assistant shows up there with no
 * change on that side, and its earlier answers are in the history it is shown
 * the next time someone asks, which is all the memory it has.
 *
 * <p>It can only talk. It is given no tools, so nothing a member (or a video
 * title) says to it can touch playback, the queue or the room.
 */
@Service
public class RoomAssistant {

    private static final Logger log = LoggerFactory.getLogger(RoomAssistant.class);

    /**
     * The author of every answer. Not a row in room_member: member ids are
     * random, so this one can never be somebody's, and clients tell the
     * assistant's messages apart by it.
     */
    public static final UUID MEMBER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");

    public static final String NAME = "WatchParty AI";

    /** The chat_message.body column, and what a member may send. */
    private static final int MAX_REPLY = 500;
    /** Earlier messages the model is shown, the assistant's own among them. */
    private static final int HISTORY = 12;
    /**
     * Calls in flight at once, and how many more may wait. The deployment's
     * per-minute budget is small, so this only has to cover a burst; past it
     * the member is told to try again rather than left in a long line.
     */
    private static final int WORKERS = 4;
    private static final int WAITING = 16;

    private static final String BUDGET_KEY = "all";

    private final AssistantModel model;
    private final ChatMessageRepository messages;
    private final RoomStateService stateService;
    private final RoomEventPublisher events;
    private final RedisRateLimiter limiter;
    private final WatchPartyMetrics metrics;
    private final AppProperties.Ai settings;

    // The model takes seconds to answer. The thread that handles a member's
    // frame must not wait on it, and neither may a database connection: the
    // workers read what they need and hold nothing while the model thinks.
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(
            WORKERS,
            WORKERS,
            30,
            TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(WAITING),
            Thread.ofPlatform().name("assistant-", 0).daemon(true).factory());

    public RoomAssistant(
            AssistantModel model,
            ChatMessageRepository messages,
            RoomStateService stateService,
            RoomEventPublisher events,
            RedisRateLimiter limiter,
            WatchPartyMetrics metrics,
            AppProperties props) {
        this.model = model;
        this.messages = messages;
        this.stateService = stateService;
        this.events = events;
        this.limiter = limiter;
        this.metrics = metrics;
        this.settings = props.ai();
        workers.allowCoreThreadTimeOut(true);
    }

    /**
     * Called for every chat message once it has been stored and sent. Returns
     * at once: a message that is for the assistant is answered later, from
     * another thread.
     *
     * @param principalName the asker's session, for telling them (and only
     *     them) why no answer is coming
     */
    public void consider(Room room, RoomMember member, ChatMessage asked, String principalName) {
        String question = AssistantPrompt.question(asked.getBody());
        if (question == null) {
            return;
        }
        if (!model.configured()) {
            decline(room, principalName, "off", "assistant_off", "The assistant is not set up on this server.");
            return;
        }
        if (question.isEmpty()) {
            decline(room, principalName, "empty", "assistant_empty",
                    "Ask something after @ai, like \"@ai what else has this director made?\"");
            return;
        }
        if (!allowed(RateLimits.AI_ASK, member.getId().toString())) {
            decline(room, principalName, "limited", "rate_limited",
                    "You are asking the assistant too fast. Give it a minute.");
            return;
        }
        if (!allowed(RateLimits.AI_ROOM, room.getId().toString())) {
            decline(room, principalName, "limited", "rate_limited",
                    "The assistant is busy in this room. Try again in a minute.");
            return;
        }
        // Last, so a refusal above never spends what everyone shares.
        if (!withinBudget()) {
            decline(room, principalName, "budget", "assistant_quota",
                    "The assistant has used up its free allowance for now. Try again later.");
            return;
        }
        try {
            workers.execute(() -> answer(room, member, asked, question, principalName));
        } catch (RejectedExecutionException ex) {
            decline(room, principalName, "busy", "assistant_busy",
                    "The assistant has a lot of questions right now. Try again in a moment.");
        }
    }

    private void answer(Room room, RoomMember member, ChatMessage asked, String question, String principalName) {
        UUID roomId = room.getId();
        typing(roomId, true);
        long started = System.nanoTime();
        try {
            String prompt = AssistantPrompt.compose(scene(room), recent(roomId, asked), member.getDisplayName(), question);
            AssistantModel.Answer answer = model.ask(prompt);
            Duration took = Duration.ofNanos(System.nanoTime() - started);
            metrics.assistantTokens(answer.promptTokens(), answer.completionTokens());

            String body = AssistantPrompt.fit(answer.text(), NAME, MAX_REPLY);
            if (body.isEmpty()) {
                // A safety block or an empty candidate: nothing went wrong, it
                // just has no reply to post.
                metrics.assistantRequest("empty");
                notify(roomId, principalName, "assistant_empty", "The assistant had nothing to say to that.");
                return;
            }

            ChatMessage saved = messages.save(new ChatMessage(roomId, MEMBER_ID, NAME, body));
            events.publish(
                    roomId,
                    "chat",
                    new ChatMessageView(saved.getId(), MEMBER_ID, NAME, saved.getBody(), saved.getCreatedAt()));
            metrics.chatMessage();
            metrics.assistantRequest("answered");
            metrics.assistantReply(took);
            log.atInfo()
                    .addKeyValue("roomId", roomId)
                    .addKeyValue("tookMs", took.toMillis())
                    .addKeyValue("promptTokens", answer.promptTokens())
                    .addKeyValue("completionTokens", answer.completionTokens())
                    .log("Assistant answered in room {}", room.getRoomCode());
        } catch (AssistantModel.Unavailable ex) {
            if (ex.outOfQuota()) {
                // The provider's limit, reached before ours: the configured
                // budget is above what the key is really allowed.
                metrics.assistantRequest("quota");
                log.warn("Assistant refused by the model's own rate limit; lower AI_REQUESTS_PER_MINUTE/DAY to match the key");
                notify(roomId, principalName, "assistant_quota",
                        "The assistant has used up its free allowance for now. Try again later.");
            } else {
                metrics.assistantRequest("failed");
                log.warn("Assistant could not answer in room {}: {}", room.getRoomCode(), ex.getMessage());
                notify(roomId, principalName, "assistant_unavailable",
                        "The assistant could not answer just now. Try again in a moment.");
            }
        } catch (RuntimeException ex) {
            // Reading the history or storing the answer failed, not the model.
            metrics.assistantRequest("failed");
            log.warn("Assistant reply failed in room {}", room.getRoomCode(), ex);
            notify(roomId, principalName, "assistant_unavailable",
                    "The assistant could not answer just now. Try again in a moment.");
        } finally {
            typing(roomId, false);
        }
    }

    /** What is on, and how far in: the live position if the room is warm, the snapshot if not. */
    private Scene scene(Room room) {
        RoomState state = stateService.read(room.getId());
        long now = System.currentTimeMillis();
        return new Scene(
                room.getTitle(),
                room.getVideoTitle(),
                room.getVideoAuthor(),
                room.getPlatform(),
                state != null ? state.projectedPositionMs(now) : room.getPositionMs(),
                state != null && state.durationMs() != null ? state.durationMs() : room.getDurationMs(),
                state != null ? state.playing() : room.isPlaying(),
                room.getQueue().stream().map(QueueItem::getTitle).filter(Objects::nonNull).toList());
    }

    /** The conversation up to the question, oldest first. */
    private List<Line> recent(UUID roomId, ChatMessage asked) {
        return messages
                .findByRoomIdAndCreatedAtBeforeOrderByCreatedAtDesc(roomId, asked.getCreatedAt(), PageRequest.of(0, HISTORY))
                .reversed()
                .stream()
                // The database keeps microseconds and the entity may hold
                // more, so "before" can still return the question itself.
                .filter(message -> !message.getId().equals(asked.getId()))
                .map(message -> new Line(message.getDisplayName(), message.getBody()))
                .toList();
    }

    private boolean allowed(RateLimits.Policy policy, String key) {
        return limiter.consume(policy.bucket(), key, policy.limit(), policy.window()).allowed();
    }

    /**
     * The whole deployment's allowance, across every room and instance. The
     * free quota belongs to the API key's project, so nothing narrower than
     * this can keep the app inside it.
     */
    private boolean withinBudget() {
        return limiter.consume("ai-minute", BUDGET_KEY, settings.requestsPerMinute(), Duration.ofMinutes(1)).allowed()
                && limiter.consume("ai-day", BUDGET_KEY, settings.requestsPerDay(), Duration.ofDays(1)).allowed();
    }

    /** Refused while the member's own frame is being handled, so their session is on this instance. */
    private void decline(Room room, String principalName, String result, String code, String message) {
        metrics.assistantRequest(result);
        events.sendError(principalName, notice(room.getId(), code, message));
    }

    /** Told later, from a worker: by then only the fan-out is sure to reach them. */
    private void notify(UUID roomId, String principalName, String code, String message) {
        events.sendToMember(roomId, principalName, notice(roomId, code, message));
    }

    private static Map<String, Object> notice(UUID roomId, String code, String message) {
        return Map.of("code", code, "message", message, "roomId", roomId.toString());
    }

    /** The same "is typing" members send, so every client already shows it. */
    private void typing(UUID roomId, boolean typing) {
        events.publish(roomId, "activity", Map.of(
                "type", "typing",
                "memberId", MEMBER_ID.toString(),
                "displayName", NAME,
                "typing", typing));
    }

    @PreDestroy
    void stop() {
        workers.shutdownNow();
    }
}
