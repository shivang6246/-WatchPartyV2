package com.watchparty.friend;

import com.watchparty.common.ApiException;
import com.watchparty.friend.FriendDtos.ActivityView;
import com.watchparty.friend.FriendDtos.AddFriendRequest;
import com.watchparty.friend.FriendDtos.FriendsOverview;
import com.watchparty.friend.FriendDtos.LinkView;
import com.watchparty.friend.FriendDtos.RoomRelations;
import com.watchparty.friend.FriendDtos.SettingsRequest;
import com.watchparty.security.AuthPrincipal;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Friends: requests, the friend list, who is watching what, and the friend link. Accounts only. */
@RestController
@RequestMapping({"/api/v1/friends", "/api/friends"})
public class FriendController {

    private final FriendService friends;

    public FriendController(FriendService friends) {
        this.friends = friends;
    }

    @GetMapping
    public FriendsOverview overview(@AuthenticationPrincipal AuthPrincipal principal) {
        return friends.overview(principal);
    }

    /** Polled by the home screen and the tab bar's badge. */
    @GetMapping("/activity")
    public ActivityView activity(@AuthenticationPrincipal AuthPrincipal principal) {
        return friends.activity(principal);
    }

    /** By email, by someone in your room, or by a friend link's code. Rate-limited per account. */
    @PostMapping("/requests")
    public FriendsOverview add(
            @AuthenticationPrincipal AuthPrincipal principal, @Valid @RequestBody AddFriendRequest request) {
        return friends.add(principal, request);
    }

    @PostMapping("/requests/{id}/accept")
    public FriendsOverview accept(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable UUID id) {
        return friends.accept(principal, id);
    }

    /** Declines a request you received or cancels one you sent. */
    @DeleteMapping("/requests/{id}")
    public FriendsOverview dismiss(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable UUID id) {
        return friends.dismiss(principal, id);
    }

    @DeleteMapping("/{userId}")
    public FriendsOverview unfriend(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable UUID userId) {
        return friends.unfriend(principal, userId);
    }

    @PatchMapping("/settings")
    public FriendsOverview settings(
            @AuthenticationPrincipal AuthPrincipal principal, @RequestBody SettingsRequest request) {
        if (request.shareActivity() == null) {
            throw ApiException.badRequest("nothing", "Nothing to change.");
        }
        return friends.setShareActivity(principal, request.shareActivity());
    }

    @GetMapping("/link")
    public LinkView link(@AuthenticationPrincipal AuthPrincipal principal) {
        return new LinkView(friends.linkCode(principal));
    }

    @PostMapping("/link/rotate")
    public LinkView rotateLink(@AuthenticationPrincipal AuthPrincipal principal) {
        return new LinkView(friends.rotateLink(principal));
    }

    /** For the People tab: which members of this room are friends, or have a request either way. */
    @GetMapping("/rooms/{roomId}")
    public RoomRelations inRoom(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable UUID roomId) {
        return friends.relationsIn(principal, roomId);
    }
}
