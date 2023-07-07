import {stylesheet} from "typestyle";

enum Action {
    ADD = "add",
    DELETE = "delete",
    UPDATE = "update",
    REQUEST_UPDATE = "request-update",
    CANCEL_UPDATE = "cancel-update",
}

const katibCSS = stylesheet({
    selectorDialog: {
        // If screen is small, use calc(100% - 120px). If screen is big, use 1200px.
        width: 600,
    },
    lockedDomain: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
    }
});

export { Action, katibCSS };
