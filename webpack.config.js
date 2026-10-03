const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const express = require('express')
const { callGeminiOptimizer } = require('./src/services/vertexOptimizer')

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production'

  return {
    entry: './src/index.jsx',
    output: {
      filename: 'bundle.js',
      path: path.resolve(__dirname, 'dist'),
      clean: true,
      publicPath: '/'
    },
    resolve: {
      extensions: ['.js', '.jsx', '.json']
    },
    module: {
      rules: [
        {
          test: /\.jsx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-env', { targets: 'defaults' }],
                ['@babel/preset-react', { runtime: 'automatic' }]
              ]
            }
          }
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
        }
      ]
    },
    plugins: [
      new HtmlWebpackPlugin({
        title: 'Agent Feedback Optimizer',
        templateContent: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Agent Feedback Optimizer</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      html, body, #extension-root {
        height: 100%;
        margin: 0;
        padding: 0;
      }
    </style>
  </head>
  <body>
    <div id="extension-root"></div>
  </body>
</html>`
      })
    ],
    devtool: isProduction ? 'source-map' : 'eval-source-map',
    devServer: {
      port: 8080,
      hot: true,
      allowedHosts: 'all',
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization'
      },
      historyApiFallback: true,
      setupMiddlewares: (middlewares, devServer) => {
        if (!devServer) {
          throw new Error('webpack-dev-server is not defined')
        }

        devServer.app.use(express.json({ limit: '10mb' }))

        devServer.app.post('/api/optimize-agent', async (req, res) => {
          try {
            const { agent, telemetry } = req.body || {}
            const result = await callGeminiOptimizer(agent || {}, telemetry || [])
            res.json(result)
          } catch (err) {
            console.error('Optimizer API error:', err)
            res.status(500).json({ error: err.message || 'Failed to run optimization' })
          }
        })

        return middlewares
      },
      client: {
        webSocketURL: 'ws://localhost:8080/ws'
      }
    }
  }
}
