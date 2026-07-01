//! Surpassing Agent Binary — main entry point.

use clap::Parser;
use surpassing_acp::{AppContext, handlers, MethodRouter, ACPServer};
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(name = "surpassing", version, about = "Surpassing IDE Agent")]
struct Args {
    #[arg(long, default_value_t = true)]
    stdio: bool,

    #[arg(long, default_value = ".surpassing/graph.db")]
    graph_path: String,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    let args = Args::parse();

    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        "Surpassing IDE Agent starting"
    );

    // Resolve graph path: if SURPASSING_WORKSPACE is set, resolve against it
    let graph_path = if let Ok(workspace) = std::env::var("SURPASSING_WORKSPACE") {
        let workspace_path = std::path::Path::new(&workspace);
        if !workspace_path.as_os_str().is_empty() {
            workspace_path.join(&args.graph_path)
        } else {
            std::path::PathBuf::from(&args.graph_path)
        }
    } else {
        std::path::PathBuf::from(&args.graph_path)
    };

    let graph = surpassing_graph::KnowledgeGraph::open(&graph_path)?;
    tracing::info!(path = %args.graph_path, "Knowledge graph opened");

    let context = AppContext::new(graph);

    let router = MethodRouter::new(context)
        .register("surpassing/initialize", handlers::handle_initialize)
        .register("surpassing/chat", handlers::handle_chat)
        .register("surpassing/shutdown", handlers::handle_shutdown)
        .register("surpassing/context/query", handlers::handle_context_query);

    if args.stdio {
        let (mut server, _shutdown_rx) = ACPServer::new(router);
        server.run().await?;
    }

    Ok(())
}
