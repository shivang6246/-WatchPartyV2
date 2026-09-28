package com.watchparty.friend;

import com.watchparty.common.ApiException;
import com.watchparty.friend.FriendDtos.ActivityView;
import com.watchparty.friend.FriendDtos.AddFriendRequest;
import com.watchparty.friend.FriendDtos.FriendView;
import com.watchparty.friend.FriendDtos.FriendsOverview;
import com.watchparty.friend.FriendDtos.RequestView;
import com.watchparty.friend.FriendDtos.RoomRelations;
import com.watchparty.friend.FriendDtos.WatchingView;
import com.watchparty.room.Room;
import com.watchparty.room.RoomMember;
import com.watchparty.room.RoomMemberRepository;
import com.watchparty.room.RoomRepository;
import com.watchparty.security.AuthPrincipal;
import com.watchparty.sync.RoomStateService;
import com.watchparty.user.AppUser;
import com.watchparty.user.AppUserRepository;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Friends: two accounts that agreed to see what the other is watching and to
 * join them in one tap.
 *
 * <p>A request becomes a friendship when the other side accepts, or at once
 * when they had already asked (two people adding each other). A friend link
 * is its owner's standing consent, so adding through one skips the request.
 *
 * <p>"Watching" is live presence, never history: a friend shows as watching
 * only while their heartbeats keep them present in an open room, and only if
 * they share their activity.
 */
@Service
public class FriendService {

    /** No 0/O or 1/I: the code is read aloud and typed from screenshots. */
    private static final char[] CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ".toCharArray();
    private static final int CODE_LENGTH = 10;

    private final FriendshipRepository friendships;
    private final AppUserRepository users;
    private final RoomMemberRepository members;
    private final RoomRepository rooms;
    private final RoomStateService stateService;
    private final SecureRandom random = new SecureRandom();

    public FriendService(
            FriendshipRepository friendships,
            AppUserRepository users,
            RoomMemberRepository members,
            RoomRepository rooms,
            RoomStateService stateService) {
        this.friendships = friendships;
        this.users = users;
        this.members = members;
        this.rooms = rooms;
        this.stateService = stateService;
    }

    /**
     * The pair in the order Postgres sorts uuids, which is the order of their
     * canonical text. {@link UUID#compareTo} compares signed halves and would
     * disagree for some pairs, breaking the table's {@code user_low < user_high}.
     */
    public static UUID[] pair(UUID a, UUID b) {
        return a.toString().compareTo(b.toString()) < 0 ? new UUID[] {a, b} : new UUID[] {b, a};
    }

    // ---- Reading ----------------------------------------------------------

    public FriendsOverview overview(AuthPrincipal principal) {
        AppUser self = requireAccount(principal);
        List<Friendship> all = friendships.findInvolving(self.getId());
        Map<UUID, AppUser> people = people(all, self.getId());

        List<Friendship> accepted = all.stream().filter(Friendship::isAccepted).toList();
        Map<UUID, WatchingView> watching = watching(accepted.stream()
                .map(f -> people.get(f.other(self.getId())))
                .filter(user -> user != null)
                .toList());

        List<FriendView> friends = accepted.stream()
                .map(f -> friendView(people.get(f.other(self.getId())), f, watching))
                .filter(view -> view != null)
                .sorted(Comparator.comparing((FriendView view) -> view.watching() == null)
                        .thenComparing(view -> view.displayName().toLowerCase()))
                .toList();

        List<RequestView> incoming = new ArrayList<>();
        List<RequestView> outgoing = new ArrayList<>();
        for (Friendship f : all) {
            if (f.isAccepted()) {
                continue;
            }
            AppUser other = people.get(f.other(self.getId()));
            if (other == null) {
                continue;
            }
            RequestView view = new RequestView(
                    f.getId(), other.getId(), other.getDisplayName(), other.getAvatarUrl(), f.getCreatedAt());
            (f.getRequestedBy().equals(self.getId()) ? outgoing : incoming).add(view);
        }
        incoming.sort(Comparator.comparing(RequestView::createdAt).reversed());
        outgoing.sort(Comparator.comparing(RequestView::createdAt).reversed());
        return new FriendsOverview(friends, incoming, outgoing, self.isShareActivity());
    }

    /** What the home screen polls: friends watching now, and requests waiting on you. */
    public ActivityView activity(AuthPrincipal principal) {
        AppUser self = requireAccount(principal);
        List<Friendship> all = friendships.findInvolving(self.getId());
        List<Friendship> accepted = all.stream().filter(Friendship::isAccepted).toList();
        int incoming = (int) all.stream()
                .filter(f -> !f.isAccepted() && !f.getRequestedBy().equals(self.getId()))
                .count();
        if (accepted.isEmpty()) {
            return new ActivityView(List.of(), incoming, 0);
        }
        Map<UUID, AppUser> people = people(accepted, self.getId());
        Map<UUID, WatchingView> watching = watching(List.copyOf(people.values()));
        List<FriendView> now = accepted.stream()
                .map(f -> people.get(f.other(self.getId())))
                .filter(user -> user != null && watching.containsKey(user.getId()))
                .map(user -> new FriendView(
                        user.getId(), user.getDisplayName(), user.getAvatarUrl(), null, watching.get(user.getId())))
                .toList();
        return new ActivityView(now, incoming, accepted.size());
    }

    /** How the caller relates to each registered member of a room they are in, for the People tab. */
    public RoomRelations relationsIn(AuthPrincipal principal, UUID roomId) {
        AppUser self = requireAccount(principal);
        members.findByRoomIdAndUserId(roomId, self.getId())
                .filter(member -> !member.isRemoved())
                .orElseThrow(() -> ApiException.forbidden("not_a_member", "You are not in this room."));

        Map<UUID, String> byUser = new HashMap<>();
        for (Friendship f : friendships.findInvolving(self.getId())) {
            byUser.put(f.other(self.getId()), f.isAccepted()
                    ? "friend"
                    : f.getRequestedBy().equals(self.getId()) ? "outgoing" : "incoming");
        }
        Map<UUID, String> byMember = new HashMap<>();
        for (RoomMember member : members.findByRoomIdAndRemovedFalseOrderByJoinedAtAsc(roomId)) {
            if (member.getUserId() != null && byUser.containsKey(member.getUserId())) {
                byMember.put(member.getId(), byUser.get(member.getUserId()));
            }
        }
        return new RoomRelations(byMember);
    }

    // ---- Changing ---------------------------------------------------------

    /** Asks someone to be friends, named by email, by room membership or by their friend link. */
    public FriendsOverview add(AuthPrincipal principal, AddFriendRequest request) {
        AppUser self = requireAccount(principal);
        if (request.code() != null && !request.code().isBlank()) {
            AppUser owner = users.findByFriendCode(request.code().trim().toUpperCase())
                    .filter(user -> user.getDeletedAt() == null)
                    .orElseThrow(() -> ApiException.notFound("That friend link does not work any more."));
            // Sharing the link was the owner's yes: no request to wait on.
            connect(self.getId(), owner.getId(), true);
        } else if (request.email() != null && !request.email().isBlank()) {
            AppUser target = users.findByEmailIgnoreCase(request.email().trim())
                    .filter(user -> user.getDeletedAt() == null)
                    .orElseThrow(() -> ApiException.notFound("Nobody on WatchParty uses that email yet."));
            connect(self.getId(), target.getId(), false);
        } else if (request.roomId() != null && request.memberId() != null) {
            connect(self.getId(), memberInSameRoom(self.getId(), request.roomId(), request.memberId()), false);
        } else {
            throw ApiException.badRequest("who", "Say who to add: an email, someone in your room, or a friend link.");
        }
        return overview(principal);
    }

    public FriendsOverview accept(AuthPrincipal principal, UUID friendshipId) {
        AppUser self = requireAccount(principal);
        Friendship f = requireOwn(friendshipId, self.getId());
        if (!f.isAccepted()) {
            if (f.getRequestedBy().equals(self.getId())) {
                throw ApiException.badRequest("own_request", "They have to accept a request you sent.");
            }
            f.accept();
            friendships.save(f);
        }
        return overview(principal);
    }

    /** Declines a request you received, or cancels one you sent. */
    public FriendsOverview dismiss(AuthPrincipal principal, UUID friendshipId) {
        AppUser self = requireAccount(principal);
        Friendship f = requireOwn(friendshipId, self.getId());
        if (f.isAccepted()) {
            throw ApiException.badRequest("already_friends", "You are already friends. Remove them instead.");
        }
        friendships.delete(f);
        return overview(principal);
    }

    public FriendsOverview unfriend(AuthPrincipal principal, UUID otherUserId) {
        AppUser self = requireAccount(principal);
        UUID[] pair = pair(self.getId(), otherUserId);
        friendships.findByUserLowAndUserHigh(pair[0], pair[1]).ifPresent(friendships::delete);
        return overview(principal);
    }

    public FriendsOverview setShareActivity(AuthPrincipal principal, boolean share) {
        AppUser self = requireAccount(principal);
        self.setShareActivity(share);
        users.save(self);
        return overview(principal);
    }

    /** The code in this account's friend link, made on first use. */
    public String linkCode(AuthPrincipal principal) {
        AppUser self = requireAccount(principal);
        return self.getFriendCode() != null ? self.getFriendCode() : assignCode(self);
    }

    /** A new code: links shared so far stop working. */
    public String rotateLink(AuthPrincipal principal) {
        return assignCode(requireAccount(principal));
    }

    // ---- Internals --------------------------------------------------------

    /**
     * Makes or advances the pair's row. If the other side already asked, this
     * is a yes; if two requests race, the unique pair key lets exactly one
     * insert win and the loser applies the same rule to the winner's row.
     */
    private void connect(UUID from, UUID to, boolean accepted) {
        if (from.equals(to)) {
            throw ApiException.badRequest("self", "That is you.");
        }
        UUID[] pair = pair(from, to);
        Optional<Friendship> existing = friendships.findByUserLowAndUserHigh(pair[0], pair[1]);
        if (existing.isEmpty()) {
            try {
                friendships.save(Friendship.between(from, to, accepted));
                return;
            } catch (DataIntegrityViolationException raced) {
                existing = friendships.findByUserLowAndUserHigh(pair[0], pair[1]);
                if (existing.isEmpty()) {
                    throw raced;
                }
            }
        }
        Friendship f = existing.get();
        if (!f.isAccepted() && (accepted || !f.getRequestedBy().equals(from))) {
            f.accept();
            friendships.save(f);
        }
    }

    private UUID memberInSameRoom(UUID selfId, UUID roomId, UUID memberId) {
        members.findByRoomIdAndUserId(roomId, selfId)
                .filter(member -> !member.isRemoved())
                .orElseThrow(() -> ApiException.forbidden("not_a_member", "You are not in this room."));
        RoomMember target = members.findById(memberId)
                .filter(member -> member.getRoomId().equals(roomId))
                .orElseThrow(() -> ApiException.notFound("They are not in this room."));
        if (target.getUserId() == null) {
            throw ApiException.badRequest("guest", "Guests have no account to be friends with yet.");
        }
        return target.getUserId();
    }

    private Friendship requireOwn(UUID friendshipId, UUID selfId) {
        return friendships.findById(friendshipId)
                .filter(f -> f.involves(selfId))
                .orElseThrow(() -> ApiException.notFound("That request is gone."));
    }

    private AppUser requireAccount(AuthPrincipal principal) {
        if (principal == null || principal.isGuest()) {
            throw ApiException.forbidden("account_required", "Friends need an account. Sign up to add friends.");
        }
        return users.findById(principal.id())
                .filter(user -> user.getDeletedAt() == null)
                .orElseThrow(() -> ApiException.unauthorized("unauthenticated", "Sign in again."));
    }

    private Map<UUID, AppUser> people(List<Friendship> list, UUID selfId) {
        Set<UUID> ids = list.stream().map(f -> f.other(selfId)).collect(Collectors.toSet());
        return users.findAllById(ids).stream()
                .filter(user -> user.getDeletedAt() == null)
                .collect(Collectors.toMap(AppUser::getId, Function.identity()));
    }

    private static FriendView friendView(AppUser user, Friendship f, Map<UUID, WatchingView> watching) {
        if (user == null) {
            return null;
        }
        return new FriendView(
                user.getId(), user.getDisplayName(), user.getAvatarUrl(), f.getAcceptedAt(), watching.get(user.getId()));
    }

    /**
     * Where each of these accounts is watching right now: open-room
     * memberships in one query, then live presence from Redis. Someone in two
     * rooms at once shows the one they were in most recently.
     */
    private Map<UUID, WatchingView> watching(List<AppUser> people) {
        List<UUID> sharing = people.stream().filter(AppUser::isShareActivity).map(AppUser::getId).toList();
        if (sharing.isEmpty()) {
            return Map.of();
        }
        List<RoomMember> memberships = members.findOpenByUserIds(sharing);
        if (memberships.isEmpty()) {
            return Map.of();
        }
        Map<UUID, Room> openRooms = rooms.findAllById(memberships.stream().map(RoomMember::getRoomId).collect(Collectors.toSet()))
                .stream()
                .filter(Room::isActive)
                .collect(Collectors.toMap(Room::getId, Function.identity()));

        Map<UUID, Long> latest = new HashMap<>();
        Map<UUID, WatchingView> result = new HashMap<>();
        Map<UUID, Integer> headcount = new HashMap<>();
        for (RoomMember membership : memberships) {
            Room room = openRooms.get(membership.getRoomId());
            if (room == null) {
                continue;
            }
            Long seen = stateService.lastHeartbeat(room.getId(), membership.getId());
            if (seen == null || seen <= latest.getOrDefault(membership.getUserId(), Long.MIN_VALUE)) {
                continue;
            }
            latest.put(membership.getUserId(), seen);
            int count = headcount.computeIfAbsent(room.getId(), id -> stateService.presentMembers(id).size());
            result.put(membership.getUserId(), new WatchingView(
                    room.getRoomCode(),
                    room.getTitle(),
                    room.getPlatform().value(),
                    room.getVideoTitle(),
                    room.getVideoThumbnail(),
                    count));
        }
        return result;
    }

    private String assignCode(AppUser self) {
        for (int attempt = 0; attempt < 3; attempt++) {
            String code = newCode();
            self.setFriendCode(code);
            try {
                users.save(self);
                return code;
            } catch (DataIntegrityViolationException taken) {
                // Another account drew the same code: 1 in 2^50, but try again.
                self = users.findById(self.getId()).orElseThrow();
            }
        }
        throw ApiException.conflict("code_unavailable", "Could not make a friend link. Try again.");
    }

    private String newCode() {
        char[] code = new char[CODE_LENGTH];
        for (int i = 0; i < CODE_LENGTH; i++) {
            code[i] = CODE_ALPHABET[random.nextInt(CODE_ALPHABET.length)];
        }
        return new String(code);
    }
}
