package com.watchparty.room;

import com.watchparty.chat.ChatService;
import com.watchparty.common.ApiException;
import com.watchparty.room.RoomDtos.AddQueueRequest;
import com.watchparty.room.RoomDtos.AdvanceQueueRequest;
import com.watchparty.room.RoomDtos.ChatPage;
import com.watchparty.room.RoomDtos.CreateRoomRequest;
import com.watchparty.room.RoomDtos.JoinRoomRequest;
import com.watchparty.room.RoomDtos.PatchRoomRequest;
import com.watchparty.room.RoomDtos.QueueItemView;
import com.watchparty.room.RoomDtos.ReorderQueueRequest;
import com.watchparty.room.RoomDtos.RoomCard;
import com.watchparty.room.RoomDtos.RoomPreview;
import com.watchparty.room.RoomDtos.RoomView;
import com.watchparty.security.AuthPrincipal;
import com.watchparty.sync.RoomWatchdog;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The room surface.
 *
 * <p>Room state is deliberately readable over REST as well as over the socket:
 * a joining client fetches it once before connecting, which is what lets a
 * phone show the room and its current position while the socket is still being
 * established.
 */
@RestController
@RequestMapping({"/api/v1/rooms", "/api/rooms"})
public class RoomController {

    private final RoomService roomService;
    private final ChatService chatService;
    private final RoomWatchdog watchdog;

    public RoomController(RoomService roomService, ChatService chatService, RoomWatchdog watchdog) {
        this.roomService = roomService;
        this.chatService = chatService;
        this.watchdog = watchdog;
    }

    /** The home screen's list of rooms this account hosts or has joined. */
    @GetMapping
    public List<RoomCard> mine(@AuthenticationPrincipal AuthPrincipal principal) {
        return roomService.roomsFor(principal);
    }

    @PostMapping
    public RoomView create(
            @AuthenticationPrincipal AuthPrincipal principal, @Valid @RequestBody CreateRoomRequest request) {
        Room room = roomService.create(principal, request);
        RoomMember self = roomService.requireMember(room.getId(), principal);
        return roomService.view(room, self);
    }

    /** Open to anyone with the room code, before they hold any token at all. */
    @GetMapping("/{code}/preview")
    public RoomPreview preview(@PathVariable String code) {
        return roomService.preview(code);
    }

    @GetMapping("/{code}")
    public RoomView get(
            @PathVariable String code,
            @AuthenticationPrincipal AuthPrincipal principal) {

        Room room = roomService.requireActiveRoom(code);
        Optional<RoomMember> self = roomService.findMember(room.getId(), principal);
        // A guest pass is scoped to one room; the code is enough for anyone else.
        if (self.isEmpty() && principal.isGuest() && !room.getId().equals(principal.roomId())) {
            throw ApiException.forbidden("guest_scope", "That guest pass is for a different room.");
        }
        return roomService.view(room, self.orElse(null));
    }

    @PostMapping("/{code}/join")
    public RoomView join(
            @PathVariable String code,
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestBody(required = false) JoinRoomRequest request) {
        Room room = roomService.requireActiveRoom(code);
        RoomMember member = roomService.join(room, principal, request);
        return roomService.view(room, member);
    }

    @PostMapping("/{code}/leave")
    public ResponseEntity<Void> leave(@PathVariable String code, @AuthenticationPrincipal AuthPrincipal principal) {
        Room room = roomService.requireActiveRoom(code);
        // A host leaving on purpose starts the same grace period as one who
        // dropped: the room is handed on if they do not come back.
        roomService.leave(room, principal).ifPresent(member -> watchdog.onMemberGone(room.getId(), member.getId()));
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/{code}")
    public RoomView patch(
            @PathVariable String code,
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody PatchRoomRequest request) {
        Room room = roomService.requireActiveRoom(code);
        Room updated = roomService.patch(room, principal, request);
        return roomService.view(updated, roomService.requireMember(updated.getId(), principal));
    }

    @DeleteMapping("/{code}")
    public ResponseEntity<Void> close(@PathVariable String code, @AuthenticationPrincipal AuthPrincipal principal) {
        Room room = roomService.requireActiveRoom(code);
        roomService.close(room, principal);
        return ResponseEntity.noContent().build();
    }

    // ---- Queue ------------------------------------------------------------

    @PostMapping("/{code}/queue")
    public List<QueueItemView> enqueue(
            @PathVariable String code,
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody AddQueueRequest request) {
        return roomService.addToQueue(roomService.requireActiveRoom(code), principal, request);
    }

    @DeleteMapping("/{code}/queue/{itemId}")
    public List<QueueItemView> dequeue(
            @PathVariable String code, @PathVariable UUID itemId, @AuthenticationPrincipal AuthPrincipal principal) {
        return roomService.removeFromQueue(roomService.requireActiveRoom(code), principal, itemId);
    }

    @PutMapping("/{code}/queue/order")
    public List<QueueItemView> reorder(
            @PathVariable String code,
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody ReorderQueueRequest request) {
        return roomService.reorderQueue(roomService.requireActiveRoom(code), principal, request);
    }

    /**
     * Plays the next queued video. Any member may report that the current one
     * ended; skipping ahead is the host's call. Idempotent: every member's
     * report after the first answers {@code advanced: false}.
     */
    @PostMapping("/{code}/queue/advance")
    public Map<String, Object> advance(
            @PathVariable String code,
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestBody AdvanceQueueRequest request) {
        boolean advanced = roomService.advanceQueue(roomService.requireActiveRoom(code), principal, request);
        return Map.of("advanced", advanced);
    }

    @GetMapping("/{code}/messages")
    public ChatPage messages(
            @PathVariable String code,
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(name = "before", required = false) Instant before,
            @RequestParam(name = "limit", defaultValue = "50") int limit) {
        Room room = roomService.requireActiveRoom(code);
        roomService.requireMember(room.getId(), principal);
        return chatService.history(room.getId(), before, limit);
    }
}
