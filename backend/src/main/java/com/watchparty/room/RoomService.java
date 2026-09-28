package com.watchparty.room;

import com.watchparty.auth.EmailVerificationService;
import com.watchparty.common.ApiException;
import com.watchparty.config.AppProperties;
import com.watchparty.metrics.WatchPartyMetrics;
import com.watchparty.room.RoomDtos.AddQueueRequest;
import com.watchparty.room.RoomDtos.AdvanceQueueRequest;
import com.watchparty.room.RoomDtos.CreateRoomRequest;
import com.watchparty.room.RoomDtos.JoinRoomRequest;
import com.watchparty.room.RoomDtos.MemberView;
import com.watchparty.room.RoomDtos.PatchRoomRequest;
import com.watchparty.room.RoomDtos.QueueItemView;
import com.watchparty.room.RoomDtos.ReorderQueueRequest;
import com.watchparty.room.RoomDtos.RoomCard;
import com.watchparty.room.RoomDtos.RoomPreview;
import com.watchparty.room.RoomDtos.RoomView;
import com.watchparty.security.AuthPrincipal;
import com.watchparty.sync.PlaybackMessage;
import com.watchparty.sync.RoomEventPublisher;
import com.watchparty.sync.RoomState;
import com.watchparty.sync.RoomStateService;
import com.watchparty.user.AppUser;
import com.watchparty.user.AppUserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.function.Consumer;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Room lifecycle, membership and authorization.
 *
 * <p>The rule that holds everything together: a valid token says who the caller
 * is, never what they may do in a room. Every operation resolves a
 * {@link RoomMember} document for the principal and checks its role.
 *
 * <p>Once a room exists, every write goes through {@link #mutate}: one short
 * transaction that locks the row, applies the change to the fresh copy and
 * commits. Several writers touch the same row — host edits, queue advances
 * reported by any member, the snapshot sweep — and serialising them on the
 * row lock is what stops one from undoing another.
 */
@Service
public class RoomService {

    private static final Logger log = LoggerFactory.getLogger(RoomService.class);

    /** No 0/O/1/I: these codes get read aloud and typed by hand. */
    private static final char[] CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".toCharArray();

    private static final SecureRandom RANDOM = new SecureRandom();

    /** How close to the end a reported "ended" must be before the server believes it. */
    static final long ENDED_TOLERANCE_MS = 5_000;

    private final RoomRepository rooms;
    private final RoomMemberRepository members;
    private final AppUserRepository users;
    private final RoomStateService stateService;
    private final RoomEventPublisher events;
    private final AppProperties props;
    private final TransactionTemplate tx;
    private final WatchPartyMetrics metrics;
    private final EmailVerificationService verification;

    public RoomService(
            RoomRepository rooms,
            RoomMemberRepository members,
            AppUserRepository users,
            RoomStateService stateService,
            RoomEventPublisher events,
            AppProperties props,
            PlatformTransactionManager transactions,
            WatchPartyMetrics metrics,
            EmailVerificationService verification) {
        this.rooms = rooms;
        this.members = members;
        this.users = users;
        this.stateService = stateService;
        this.events = events;
        this.props = props;
        this.tx = new TransactionTemplate(transactions);
        this.metrics = metrics;
        this.verification = verification;
    }

    // ---- Lookup -----------------------------------------------------------

    public Room requireActiveRoom(String code) {
        Room room = rooms.findByRoomCodeAndActiveTrue(code.toUpperCase())
                .orElseThrow(() -> ApiException.notFound("No open room with that code."));
        if (room.getExpiresAt().isBefore(Instant.now())) {
            throw ApiException.notFound("That room has expired.");
        }
        return room;
    }

    public Room requireRoomById(UUID roomId) {
        return rooms.findById(roomId).orElseThrow(() -> ApiException.notFound("No such room."));
    }

    /**
     * What a stranger may see before they hold any token. The room code alone
     * is enough to find and join a room. Codes are short and typed by humans,
     * so they can be guessed; the per-IP ROOM_LOOKUP and GUEST_ISSUE limits
     * are what keep guessing slow.
     */
    public RoomPreview preview(String code) {
        Room room = requireActiveRoom(code);
        return new RoomPreview(
                room.getRoomCode(),
                room.getTitle(),
                room.getPlatform().value(),
                room.getVideoTitle(),
                room.getVideoThumbnail(),
                room.isLocked(),
                room.isActive(),
                // Who is actually connected right now, not everyone who once joined.
                stateService.presentMembers(room.getId()).size());
    }

    public Optional<RoomMember> findMember(UUID roomId, AuthPrincipal principal) {
        return principal.isGuest()
                ? members.findByRoomIdAndGuestId(roomId, principal.id())
                : members.findByRoomIdAndUserId(roomId, principal.id());
    }

    public RoomMember requireMember(UUID roomId, AuthPrincipal principal) {
        RoomMember member = findMember(roomId, principal)
                .orElseThrow(() -> ApiException.forbidden("not_a_member", "You are not in this room."));
        if (member.isRemoved()) {
            throw ApiException.forbidden("removed", "You were removed from this room.");
        }
        return member;
    }

    public RoomMember requireHost(UUID roomId, AuthPrincipal principal) {
        RoomMember member = requireMember(roomId, principal);
        if (!member.isHost()) {
            throw ApiException.forbidden("host_only", "Only the host can do that.");
        }
        return member;
    }

    /**
     * The home screen's list: rooms this account hosts or has joined. Two
     * queries whatever the number of rooms (the client polls it), and the
     * counts come from live presence in Redis.
     */
    public List<RoomCard> roomsFor(AuthPrincipal principal) {
        if (principal == null || principal.isGuest()) {
            return List.of();
        }
        Map<UUID, Boolean> hostOf = new HashMap<>();
        for (RoomMember membership : members.findByUserIdAndRemovedFalse(principal.id())) {
            hostOf.merge(membership.getRoomId(), membership.isHost(), Boolean::logicalOr);
        }
        if (hostOf.isEmpty()) {
            return List.of();
        }
        List<RoomCard> cards = new ArrayList<>();
        for (Room room : rooms.findByIdInAndActiveTrue(hostOf.keySet())) {
            cards.add(card(room, hostOf.get(room.getId())));
        }
        cards.sort(Comparator.comparing(RoomCard::updatedAt).reversed());
        return cards;
    }

    private RoomCard card(Room room, boolean host) {
        return new RoomCard(
                room.getId(),
                room.getRoomCode(),
                room.getTitle(),
                room.getPlatform().value(),
                room.getVideoTitle(),
                room.getVideoThumbnail(),
                host,
                stateService.presentMembers(room.getId()).size(),
                room.getUpdatedAt());
    }

    // ---- Creation ---------------------------------------------------------

    public Room create(AuthPrincipal principal, CreateRoomRequest request) {
        if (principal.isGuest()) {
            throw ApiException.forbidden("account_required", "Create an account to host a room.");
        }
        AppUser host = users.findById(principal.id())
                .orElseThrow(() -> ApiException.unauthorized("unknown_user", "Account not found."));
        // Hosting is the one thing an unconfirmed address cannot do: a guest
        // needs no account at all, so watching, chatting and reacting are open.
        if (verification.required() && !host.isEmailVerified()) {
            throw ApiException.forbidden(
                    "email_unverified", "Confirm your email address to host a room. Check your inbox.");
        }

        Platform platform = parsePlatform(request.platform());
        VideoSource source = VideoSource.resolve(platform, request.videoUrl());

        int maxMembers = request.maxMembers() == null
                ? props.room().maxMembers()
                : Math.min(request.maxMembers(), props.room().maxMembers());

        String title = (request.title() == null || request.title().isBlank())
                ? (request.videoTitle() == null || request.videoTitle().isBlank()
                        ? "Watch Party"
                        : request.videoTitle().trim())
                : request.title().trim();

        Room room = new Room(nextRoomCode(), randomToken(), host.getId(), title, source.platform(), maxMembers);
        applySource(room, source, request.videoTitle(), request.videoThumbnail(), request.videoAuthor(),
                request.durationMs());
        room.setExpiresAt(Instant.now().plus(props.room().ttl()));
        room.setCurrentItemId(UUID.randomUUID());
        if ("public".equals(request.visibility())) {
            room.setVisibility("public");
        }
        // The one whole-document write: the room does not exist yet.
        rooms.save(room);

        RoomMember hostMember = RoomMember.forUser(room.getId(), host.getId(), host.getDisplayName(), MemberRole.HOST);
        hostMember.setAvatarUrl(host.getAvatarUrl());
        members.save(hostMember);
        stateService.hydrate(room);
        log.info("Room {} created by user {}", room.getRoomCode(), host.getId());
        return room;
    }

    private void applySource(
            Room room, VideoSource source, String title, String thumbnail, String author, Long durationMs) {
        room.setPlatform(source.platform());
        room.setVideoUrl(source.url());
        room.setVideoRef(source.ref());
        room.setVideoTitle(title);
        room.setVideoThumbnail(thumbnail == null && source.ref() != null && source.platform() == Platform.YOUTUBE
                ? "https://i.ytimg.com/vi/" + source.ref() + "/hqdefault.jpg"
                : thumbnail);
        room.setVideoAuthor(author);
        room.setDurationMs(durationMs);
    }

    private Platform parsePlatform(String raw) {
        try {
            return Platform.from(raw);
        } catch (IllegalArgumentException ex) {
            throw ApiException.badRequest("platform_invalid", "Unsupported platform: " + raw);
        }
    }

    private String nextRoomCode() {
        for (int attempt = 0; attempt < 12; attempt++) {
            StringBuilder code = new StringBuilder(6);
            for (int i = 0; i < 6; i++) {
                code.append(CODE_ALPHABET[RANDOM.nextInt(CODE_ALPHABET.length)]);
            }
            String candidate = code.toString();
            if (!rooms.existsByRoomCodeAndActiveTrue(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("Could not allocate a free room code.");
    }

    /** 128 bits of randomness: this is the real access credential for a room. */
    public static String randomToken() {
        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    // ---- Joining ----------------------------------------------------------

    public RoomMember join(Room room, AuthPrincipal principal, JoinRoomRequest request) {
        if (!room.isActive()) {
            throw ApiException.conflict("room_closed", "That room has closed.");
        }

        Optional<RoomMember> existing = findMember(room.getId(), principal);
        if (existing.isPresent()) {
            RoomMember member = existing.get();
            if (member.isRemoved()) {
                throw ApiException.forbidden("removed", "You were removed from this room.");
            }
            member.markRejoined();
            if (request != null && request.displayName() != null && !request.displayName().isBlank()) {
                member.setDisplayName(sanitizeName(request.displayName()));
            }
            members.save(member);
            broadcastMembers(room);
            return member;
        }

        if (members.countByRoomIdAndLeftAtIsNullAndRemovedFalse(room.getId()) >= room.getMaxMembers()) {
            throw ApiException.conflict("room_full", "This room is full.");
        }

        RoomMember member;
        if (principal.isGuest()) {
            if (!room.getId().equals(principal.roomId())) {
                throw ApiException.forbidden("guest_scope", "That guest pass is for a different room.");
            }
            String name = sanitizeName(request != null && request.displayName() != null
                    ? request.displayName()
                    : principal.displayName());
            member = RoomMember.forGuest(room.getId(), principal.id(), name);
        } else {
            AppUser user = users.findById(principal.id())
                    .orElseThrow(() -> ApiException.unauthorized("unknown_user", "Account not found."));
            boolean isHost = room.getHostUserId().equals(user.getId());
            String name = sanitizeName(
                    request != null && request.displayName() != null && !request.displayName().isBlank()
                            ? request.displayName()
                            : user.getDisplayName());
            member = RoomMember.forUser(room.getId(), user.getId(), name, isHost ? MemberRole.HOST : MemberRole.MEMBER);
            member.setAvatarUrl(user.getAvatarUrl());
        }
        try {
            members.save(member);
        } catch (DataIntegrityViolationException race) {
            // Two joins for the same person landed together (a second tab, or
            // React running the page's effect twice in development): both saw
            // no row and both inserted, and the unique index kept only one.
            // That row is this caller's seat, so answer as a rejoin.
            RoomMember winner = findMember(room.getId(), principal).orElseThrow(() -> race);
            if (winner.isRemoved()) {
                throw ApiException.forbidden("removed", "You were removed from this room.");
            }
            return winner;
        }
        broadcastMembers(room);
        return member;
    }

    /** @return the member who left, if the caller was one */
    public Optional<RoomMember> leave(Room room, AuthPrincipal principal) {
        Optional<RoomMember> member = findMember(room.getId(), principal);
        member.ifPresent(m -> {
            m.markLeft();
            members.save(m);
            stateService.removePresence(room.getId(), m.getId());
        });
        broadcastMembers(room);
        return member;
    }

    // ---- Host actions -----------------------------------------------------

    public Room patch(Room room, AuthPrincipal principal, PatchRoomRequest request) {
        requireHost(room.getId(), principal);
        if (Boolean.FALSE.equals(request.locked())) {
            // Playback is the host's alone. Only the watchdog opens it up, and
            // only for a room whose host is gone with nobody to promote.
            throw ApiException.forbidden("host_only_playback", "Playback stays with the host.");
        }

        boolean videoChanged = request.videoUrl() != null || request.platform() != null;
        VideoSource source = videoChanged
                ? VideoSource.resolve(
                        request.platform() == null ? room.getPlatform() : parsePlatform(request.platform()),
                        request.videoUrl())
                : null;

        Room updated = mutate(room.getId(), r -> {
            if (request.title() != null && !request.title().isBlank()) {
                r.setTitle(request.title().trim());
            }
            if (source != null) {
                applySource(r, source, request.videoTitle(), request.videoThumbnail(), request.videoAuthor(),
                        request.durationMs());
                r.setPositionMs(0);
                r.setPlaying(false);
                r.setAnchorTs(Instant.now());
                // A hand-picked video is a new item, so a late "ended" report
                // for the old one cannot advance the queue past it.
                r.setCurrentItemId(UUID.randomUUID());
                if (request.title() == null && request.videoTitle() != null && !request.videoTitle().isBlank()) {
                    r.setTitle(request.videoTitle().trim());
                }
            }
            if (request.locked() != null) {
                r.setLocked(request.locked());
            }
            if (Boolean.TRUE.equals(request.rotateInviteToken())) {
                // Lets a host who shared the link too widely cut it off without
                // closing the room.
                r.setInviteToken(randomToken());
            }
            r.touch();
        });

        if (source != null) {
            startOver(updated);
        }
        if (request.locked() != null) {
            stateService.setLocked(updated.getId(), request.locked());
        }

        if (request.transferHostToMemberId() != null) {
            transferHost(updated, request.transferHostToMemberId(), "transfer");
        }

        if (request.removeMemberId() != null) {
            removeMember(updated, request.removeMemberId());
        }

        if (request.muteMemberId() != null && request.muted() != null) {
            setMuted(updated, request.muteMemberId(), request.muted());
        }

        broadcastMembers(updated);
        if (videoChanged || request.title() != null) {
            events.publish(updated.getId(), "members", Map.of("type", "room", "room", publicRoom(updated)));
        }
        return updated;
    }

    /**
     * The one way an existing room is written: lock the row, apply the change
     * to the fresh copy, commit. Two writers on the same room simply take
     * turns, so neither can undo the other.
     *
     * @return the room as committed
     */
    Room mutate(UUID roomId, Consumer<Room> change) {
        return tx.execute(status -> {
            Room fresh = rooms.findByIdForUpdate(roomId).orElseThrow(() -> ApiException.notFound("No such room."));
            change.accept(fresh);
            return fresh;
        });
    }

    /**
     * A new video means a clean anchor: everyone starts at zero, paused, and
     * gets a fresh playback event so nobody is left on the old one.
     */
    private void startOver(Room room) {
        RoomState state = stateService.resetPlayback(room);
        if (state != null) {
            events.publish(room.getId(), "playback", PlaybackMessage.from(state, "load", null));
        }
    }

    /** The name STOMP routes a member's user-destination messages by. */
    public static String principalName(RoomMember member) {
        return member.getUserId() != null ? "user:" + member.getUserId() : "guest:" + member.getGuestId();
    }

    private RoomMember requireMemberOfRoom(Room room, UUID memberId) {
        RoomMember target = members.findById(memberId).orElseThrow(() -> ApiException.notFound("No such member."));
        if (!target.getRoomId().equals(room.getId())) {
            throw ApiException.notFound("No such member.");
        }
        return target;
    }

    /**
     * Host transfer targets a registered member: the host field holds an account
     * id, which is also what lets a host reclaim a room after clearing their
     * browser.
     *
     * <p>The member rows and the room row change in one transaction, so a
     * failure part-way leaves the room exactly as it was.
     *
     * @param reason "transfer" for a host's own hand-off, "failover" when the
     *     watchdog promotes someone after the host dropped
     */
    public void transferHost(Room room, UUID newHostMemberId, String reason) {
        RoomMember target = requireMemberOfRoom(room, newHostMemberId);
        if (target.getUserId() == null) {
            throw ApiException.badRequest("guest_cannot_host", "That member is a guest. Hosting needs an account.");
        }
        if (target.isRemoved()) {
            throw ApiException.badRequest("member_removed", "That member was removed from the room.");
        }

        UUID previousHostMemberId = tx.execute(status -> {
            Room locked = rooms.findByIdForUpdate(room.getId())
                    .orElseThrow(() -> ApiException.notFound("No such room."));
            UUID previousHostUserId = locked.getHostUserId();
            target.setRole(MemberRole.HOST);
            members.save(target);
            locked.setHostUserId(target.getUserId());
            return members.findByRoomIdAndUserId(room.getId(), previousHostUserId)
                    .filter(previous -> !previous.getId().equals(target.getId()))
                    .map(previous -> {
                        previous.setRole(MemberRole.MEMBER);
                        members.save(previous);
                        return previous.getId();
                    })
                    .orElse(null);
        });
        room.setHostUserId(target.getUserId());
        // Any hand-off, deliberate or not, ends a pending failover.
        stateService.cancelHostAway(room.getId());

        Map<String, Object> event = new HashMap<>();
        event.put("type", "host");
        event.put("hostMemberId", target.getId().toString());
        event.put("hostName", target.getDisplayName());
        event.put("reason", reason);
        if (previousHostMemberId != null) {
            event.put("previousHostMemberId", previousHostMemberId.toString());
        }
        events.publish(room.getId(), "members", event);
        broadcastMembers(room);
        log.info("Room {} host transferred to member {} ({})", room.getRoomCode(), target.getId(), reason);
    }

    /**
     * A kick: the member row is flagged, so every later ticket, join and frame
     * is refused, and their open sockets are closed on whichever instance
     * holds them — otherwise their subscriptions would keep delivering the room.
     */
    public void removeMember(Room room, UUID memberId) {
        RoomMember target = requireMemberOfRoom(room, memberId);
        if (target.isHost()) {
            throw ApiException.badRequest("cannot_remove_host", "Transfer hosting before removing the host.");
        }
        target.setRemoved(true);
        target.markLeft();
        members.save(target);
        stateService.removePresence(room.getId(), target.getId());
        events.disconnectMember(room.getId(), target.getId(), principalName(target), Map.of(
                "code", "removed",
                "message", "The host removed you from this room.",
                "roomId", room.getId().toString()));
        metrics.memberKicked();
        log.info("Room {} removed member {}", room.getRoomCode(), target.getId());
    }

    /** Muting silences chat, reactions and typing; the member keeps watching. */
    public void setMuted(Room room, UUID memberId, boolean muted) {
        RoomMember target = requireMemberOfRoom(room, memberId);
        if (target.isHost()) {
            throw ApiException.badRequest("cannot_mute_host", "The host cannot be muted.");
        }
        target.setMuted(muted);
        members.save(target);
        events.sendToMember(room.getId(), principalName(target), Map.of(
                "code", muted ? "muted" : "unmuted",
                "message", muted ? "The host muted you." : "The host unmuted you.",
                "roomId", room.getId().toString()));
    }

    public void close(Room room, AuthPrincipal principal) {
        requireHost(room.getId(), principal);
        closeRoom(room, "host");
    }

    /**
     * Every way a room ends goes through here: the host closing it, the
     * watchdog finding it empty, or the expiry sweep.
     *
     * @param reason host, empty or expired; sent to members and to metrics
     */
    public void closeRoom(Room room, String reason) {
        RoomState state = stateService.read(room.getId());
        mutate(room.getId(), r -> {
            applySnapshot(r, state);
            r.close();
        });
        stateService.clear(room.getId());
        events.publish(room.getId(), "members", Map.of("type", "closed", "reason", reason));
        metrics.roomClosed(reason);
        log.info("Room {} closed ({})", room.getRoomCode(), reason);
    }

    /** Writes live Redis state back onto the room row. */
    public void snapshot(Room room) {
        RoomState state = stateService.read(room.getId());
        if (state == null) {
            return;
        }
        mutate(room.getId(), r -> applySnapshot(r, state));
    }

    private static void applySnapshot(Room room, RoomState state) {
        if (state == null) {
            return;
        }
        room.setPositionMs(state.projectedPositionMs(System.currentTimeMillis()));
        room.setPlaying(state.playing());
        room.setSpeed(state.speed());
        room.setSequenceNumber(state.sequence());
        room.setAnchorTs(Instant.now());
        room.setLocked(state.locked());
        if (state.durationMs() != null) {
            room.setDurationMs(state.durationMs());
        }
        room.touch();
    }

    // ---- Queue ------------------------------------------------------------

    /**
     * Who may edit the queue: the same rule as changing the video by hand,
     * kept in one place so widening it later is a one-line change.
     */
    private RoomMember requireQueueControl(Room room, AuthPrincipal principal) {
        return requireHost(room.getId(), principal);
    }

    public List<QueueItemView> addToQueue(Room room, AuthPrincipal principal, AddQueueRequest request) {
        RoomMember member = requireQueueControl(room, principal);
        VideoSource source = VideoSource.resolve(parsePlatform(request.platform()), request.videoUrl());
        QueueItem item = new QueueItem(
                source,
                blankToNull(request.videoTitle()),
                blankToNull(request.videoThumbnail()),
                blankToNull(request.videoAuthor()),
                request.durationMs(),
                member.getId(),
                member.getDisplayName());

        int max = props.room().maxQueue();
        Room updated = mutate(room.getId(), r -> {
            // Checked under the row lock, so two adds racing for the last slot
            // cannot both land.
            if (r.getQueue().size() >= max) {
                throw ApiException.conflict("queue_full", "The queue is full (" + max + " videos).");
            }
            List<QueueItem> next = new ArrayList<>(r.getQueue());
            next.add(item);
            r.setQueue(next);
        });
        return broadcastQueue(updated);
    }

    public List<QueueItemView> removeFromQueue(Room room, AuthPrincipal principal, UUID itemId) {
        requireQueueControl(room, principal);
        Room updated = mutate(room.getId(), r -> {
            List<QueueItem> next = new ArrayList<>(r.getQueue());
            if (!next.removeIf(item -> item.getItemId().equals(itemId))) {
                throw ApiException.notFound("That video is not in the queue.");
            }
            r.setQueue(next);
        });
        return broadcastQueue(updated);
    }

    public List<QueueItemView> reorderQueue(Room room, AuthPrincipal principal, ReorderQueueRequest request) {
        requireQueueControl(room, principal);
        Room updated = mutate(room.getId(), r -> r.setQueue(reordered(r.getQueue(), request.itemIds())));
        return broadcastQueue(updated);
    }

    /**
     * Puts the queue in the order given. The order must name every current
     * item exactly once, so a client working from a stale copy is refused
     * rather than silently dropping or duplicating a video.
     */
    public static List<QueueItem> reordered(List<QueueItem> queue, List<UUID> order) {
        if (order == null || order.size() != queue.size() || new HashSet<>(order).size() != order.size()) {
            throw ApiException.conflict("queue_changed", "The queue changed. Refresh and try again.");
        }
        Map<UUID, QueueItem> byItemId = new HashMap<>();
        for (QueueItem item : queue) {
            byItemId.put(item.getItemId(), item);
        }
        List<QueueItem> result = new ArrayList<>(order.size());
        for (UUID id : order) {
            QueueItem item = byItemId.get(id);
            if (item == null) {
                throw ApiException.conflict("queue_changed", "The queue changed. Refresh and try again.");
            }
            result.add(item);
        }
        return result;
    }

    /**
     * Whether a member's report that the video ended is credible, judged by
     * the server's own projection and its own record of the duration. The
     * reporter's idea of the length is never used: a member claiming a video
     * is short would otherwise be able to skip it.
     */
    public static boolean plausiblyEnded(long projectedMs, Long knownDurationMs) {
        if (knownDurationMs == null || knownDurationMs <= 0) {
            return false;
        }
        return projectedMs >= knownDurationMs - ENDED_TOLERANCE_MS;
    }

    /**
     * Moves the next queued video into the player.
     *
     * <p>Every member's player ends at about the same moment and each of them
     * reports it, so this has to be idempotent: under the row lock the item
     * being replaced must still be current, so only the first report wins and
     * the rest find the queue already moved on.
     *
     * @return true if this call advanced the queue
     */
    public boolean advanceQueue(Room room, AuthPrincipal principal, AdvanceQueueRequest request) {
        RoomMember member = requireMember(room.getId(), principal);
        String reason = "ended".equals(request.reason()) ? "ended" : "skip";

        if ("skip".equals(reason)) {
            requireQueueControl(room, principal);
        } else {
            RoomState state = stateService.load(room);
            long projected = state.projectedPositionMs(System.currentTimeMillis());
            if (!plausiblyEnded(projected, state.durationMs())) {
                throw ApiException.conflict("not_ended", "The video has not finished for the room yet.");
            }
        }

        Room advanced = tx.execute(status -> {
            Room r = rooms.findByIdForUpdate(room.getId()).orElseThrow(() -> ApiException.notFound("No such room."));
            if (request.ifCurrent() != null && !request.ifCurrent().equals(r.getCurrentItemId())) {
                // Another member's report, or a host edit, got there first.
                return null;
            }
            List<QueueItem> queue = r.getQueue();
            if (queue.isEmpty()) {
                return null;
            }
            QueueItem next = queue.get(0);
            VideoSource source = new VideoSource(next.getPlatform(), next.getVideoUrl(), next.getVideoRef());
            applySource(r, source, next.getTitle(), next.getThumbnail(), next.getAuthor(), next.getDurationMs());
            r.setCurrentItemId(next.getItemId());
            r.setPositionMs(0);
            r.setPlaying(false);
            r.setAnchorTs(Instant.now());
            if (next.getTitle() != null && !next.getTitle().isBlank()) {
                r.setTitle(next.getTitle().trim());
            }
            r.setQueue(queue.subList(1, queue.size()));
            r.touch();
            return r;
        });
        if (advanced == null) {
            return false;
        }

        startOver(advanced);
        events.publish(advanced.getId(), "members", Map.of("type", "room", "room", publicRoom(advanced)));
        broadcastQueue(advanced);
        metrics.queueAdvanced(reason);
        log.info("Room {} advanced its queue ({}) by member {}", advanced.getRoomCode(), reason, member.getId());
        return true;
    }

    private List<QueueItemView> broadcastQueue(Room room) {
        List<QueueItemView> views = room.getQueue().stream().map(QueueItemView::of).toList();
        Map<String, Object> event = new HashMap<>();
        event.put("type", "queue");
        event.put("queue", views);
        event.put("currentItemId", room.getCurrentItemId() == null ? null : room.getCurrentItemId().toString());
        events.publish(room.getId(), "members", event);
        return views;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    // ---- Views and broadcasts ---------------------------------------------

    public RoomView view(Room room, RoomMember self) {
        RoomState state = stateService.load(room);
        List<MemberView> memberViews = roster(room.getId());
        UUID hostMemberId = memberViews.stream()
                .filter(m -> MemberRole.HOST.value().equals(m.role()))
                .map(MemberView::id)
                .findFirst()
                .orElse(null);

        boolean isHost = self != null && self.isHost();
        return new RoomView(
                room.getId(),
                room.getRoomCode(),
                room.getTitle(),
                room.getPlatform().value(),
                room.getVideoUrl(),
                room.getVideoRef(),
                room.getVideoTitle(),
                room.getVideoThumbnail(),
                room.getVideoAuthor(),
                state.locked(),
                room.isActive(),
                room.getMaxMembers(),
                room.getExpiresAt(),
                hostMemberId,
                // Only the host gets the invite token back; they are the one who
                // shares it, and it is the room's real access credential.
                isHost ? room.getInviteToken() : null,
                self == null ? null : self.getId(),
                self == null ? null : self.getRole().value(),
                memberViews,
                PlaybackMessage.from(state, "sync", null),
                System.currentTimeMillis(),
                room.getCurrentItemId(),
                room.getQueue().stream().map(QueueItemView::of).toList(),
                stateService.hostAwayDeadline(room.getId()));
    }

    /** The subset of room fields that are safe to push to every member. */
    private Map<String, Object> publicRoom(Room room) {
        Map<String, Object> view = new HashMap<>();
        view.put("title", room.getTitle());
        view.put("platform", room.getPlatform().value());
        view.put("videoUrl", room.getVideoUrl());
        view.put("videoRef", room.getVideoRef());
        view.put("videoTitle", room.getVideoTitle());
        view.put("videoThumbnail", room.getVideoThumbnail());
        view.put("videoAuthor", room.getVideoAuthor());
        view.put("locked", room.isLocked());
        view.put("currentItemId", room.getCurrentItemId() == null ? null : room.getCurrentItemId().toString());
        return view;
    }

    public List<MemberView> roster(UUID roomId) {
        Set<UUID> present = stateService.presentMembers(roomId);
        return members.findByRoomIdAndRemovedFalseOrderByJoinedAtAsc(roomId).stream()
                .filter(m -> m.getLeftAt() == null || present.contains(m.getId()))
                .map(m -> new MemberView(
                        m.getId(),
                        m.getDisplayName(),
                        m.getAvatarUrl(),
                        m.getRole().value(),
                        m.getGuestId() != null,
                        present.contains(m.getId()),
                        m.isMuted(),
                        m.getJoinedAt()))
                .toList();
    }

    public void broadcastMembers(Room room) {
        broadcastMembers(room.getId());
    }

    public void broadcastMembers(UUID roomId) {
        events.publish(roomId, "members", Map.of("type", "roster", "members", roster(roomId)));
    }

    private static String sanitizeName(String raw) {
        if (raw == null || raw.isBlank()) {
            return "Guest";
        }
        String trimmed = raw.trim().replaceAll("\\s+", " ");
        return trimmed.length() > 40 ? trimmed.substring(0, 40) : trimmed;
    }

    /** Invite tokens are compared without leaking a prefix match through timing. */
    public static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
}
