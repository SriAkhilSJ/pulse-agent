//! Agent Client Protocol (ACP) — JSON-RPC 2.0 server over stdio.

#![warn(missing_docs)]
#![warn(unreachable_pub)]

pub mod context;
pub mod handlers;
pub mod routing;
pub mod server;
pub mod transport;

pub use context::AppContext;
pub use handlers::*;
pub use routing::MethodRouter;
pub use server::ACPServer;
pub use transport::StdioTransport;
