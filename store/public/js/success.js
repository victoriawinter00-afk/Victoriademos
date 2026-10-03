/* Success page: shows the recorded order, and clears the cart only once the
   order is known to exist.

   Why the sequencing matters: the payment provider redirects the customer here
   the moment payment completes, and its confirmation can arrive a moment later.
   Clearing the cart on page load would also punish someone who abandoned
   checkout and came back. So the cart is emptied ONLY in the "recorded" state - 
   never on load, never while the order is still arriving, never when the lookup
   fails. */
(function () {
    "use strict";

    /* Bounded retry: a few attempts over a few seconds, then an honest stop.
       This never spins indefinitely and never reads as failure to someone who
       has already paid. */
    var RETRY_DELAYS = [1200, 2500, 4000, 6000];

    var SESSION_ID = /^cs_[A-Za-z0-9_]{10,200}$/;

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function formatPrice(cents, currency) {
        if (cents === 0) return "Free";
        try {
            return new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: (currency || "usd").toUpperCase()
            }).format(cents / 100);
        } catch (err) {
            return (cents / 100).toFixed(2);
        }
    }

    function sessionIdFromQuery() {
        var params = new URLSearchParams(window.location.search);
        var id = params.get("session_id") || "";
        return SESSION_ID.test(id) ? id : "";
    }

    function setStatus(text) {
        var status = document.getElementById("order-status");
        if (status) status.textContent = text;
    }

    function setCopy(headline, explanation) {
        var headlineNode = document.getElementById("order-headline");
        var explanationNode = document.getElementById("order-explanation");
        if (headlineNode) headlineNode.textContent = headline;
        if (explanationNode) explanationNode.textContent = explanation;
    }

    function renderRecorded(order) {
        var list = document.getElementById("order-lines");
        var summary = document.getElementById("order-summary");
        var shipping = document.getElementById("order-shipping");

        if (list) {
            list.textContent = "";
            (order.items || []).forEach(function (item) {
                var row = el("li", "order-line");
                row.appendChild(el("span", "order-line__name", item.name + " × " + item.quantity));
                row.appendChild(
                    el(
                        "span",
                        "order-line__price",
                        formatPrice(item.unit_price_cents * item.quantity, order.currency)
                    )
                );
                list.appendChild(row);
            });
        }

        var total = document.getElementById("order-total");
        if (total) total.textContent = formatPrice(order.total_cents, order.currency);

        if (shipping) {
            if (order.shipping_cents > 0) {
                shipping.hidden = false;
                shipping.textContent =
                    "Includes " + formatPrice(order.shipping_cents, order.currency) + " shipping.";
            } else {
                shipping.hidden = true;
                shipping.textContent = "";
            }
        }

        if (summary) summary.hidden = false;

        setStatus("Order confirmed.");
        setCopy(
            "Your order is recorded. No real money changed hands.",
            "This is a demonstration store running on a test payment account, so no real payment was taken and nothing will ship. The order was recorded from the payment provider's own confirmation, never from this browser."
        );

        /* The only place the cart is ever cleared: the order is known to exist. */
        if (window.StoreCart) window.StoreCart.clear();
    }

    function renderPending() {
        setStatus("Still confirming your order.");
        setCopy(
            "Your payment went through. We are still confirming the order.",
            "The payment provider accepted your payment but has not yet told the store. That is normal and usually takes only a moment - the order is recorded as soon as its confirmation arrives. Your cart has been kept, so nothing you chose is lost."
        );
    }

    function renderNotFound() {
        setStatus("No order was found for this link.");
        setCopy(
            "We could not find an order for this link.",
            "This page shows an order only once the payment provider has confirmed one. The link may be incomplete, or the payment was not completed. Your cart has been kept, so you can try again."
        );
    }

    function renderNoLink() {
        setStatus("This page needs the order link from your payment.");
        setCopy(
            "This page needs the order link the payment provider sent you.",
            "Open the link from your payment confirmation, or return to the store and start again. Your cart has been kept."
        );
    }

    function load(attempt) {
        fetch("/api/orders/" + encodeURIComponent(sessionId), { headers: { accept: "application/json" } })
            .then(function (response) {
                return response
                    .json()
                    .catch(function () {
                        return {};
                    })
                    .then(function (data) {
                        return { status: response.status, data: data };
                    });
            })
            .then(function (result) {
                if (result.status === 200 && result.data && result.data.status === "recorded") {
                    renderRecorded(result.data.order);
                    return;
                }
                if (result.status === 404) {
                    // Definitively no completed payment for this link.
                    renderNotFound();
                    return;
                }
                retryOrStop(attempt);
            })
            .catch(function () {
                retryOrStop(attempt);
            });
    }

    function retryOrStop(attempt) {
        if (attempt < RETRY_DELAYS.length) {
            window.setTimeout(function () {
                load(attempt + 1);
            }, RETRY_DELAYS[attempt]);
            return;
        }
        renderPending();
    }

    var sessionId = sessionIdFromQuery();

    function start() {
        if (!sessionId) {
            renderNoLink();
            return;
        }
        load(0);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
